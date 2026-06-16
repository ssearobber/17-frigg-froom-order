const { GoogleSpreadsheet } = require('google-spreadsheet');
const { shopifyOrderDetail } = require('./shopifyOrderDetail');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function colIndexToLetter(index) {
  let letter = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    letter = String.fromCharCode(65 + r) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

let _orderSheet        = null;
let _orderRows         = null;    // getRows() 결과: [0]=한국어레이블행, [1~]=데이터
let _orderRowMap       = null;    // orderID → _orderRows 인덱스(i)
let _isCompletedColIdx = null;    // isCompleted 열 0-indexed 위치 (동적 감지)

async function _initOrderSheet() {
  if (_orderSheet !== null) return;

  if (!process.env.GOOGLE_SPREAD_ID) throw new Error('GOOGLE_SPREAD_ID 환경변수가 설정되지 않았습니다.');
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL 환경변수가 설정되지 않았습니다.');
  if (!process.env.GOOGLE_PRIVATE_KEY) throw new Error('GOOGLE_PRIVATE_KEY 환경변수가 설정되지 않았습니다.');
  if (!process.env.GOOGLE_ORDER_SHEET_ID) throw new Error('GOOGLE_ORDER_SHEET_ID 환경변수가 설정되지 않았습니다.');

  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SPREAD_ID);
  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/"/g, '').replace(/\\n/g, '\n'),
  });
  await doc.loadInfo();
  _orderSheet = doc.sheetsById[process.env.GOOGLE_ORDER_SHEET_ID];

  // getRows()는 시트 1행(영문헤더)을 컬럼명으로 취급
  // _orderRows[0] = 한국어레이블행(시트 2행), _orderRows[1~] = 실제 데이터
  _orderRows = await _orderSheet.getRows();

  // isCompleted 열 위치 동적 감지 — 열 삽입에 무관하게 동작
  _isCompletedColIdx = _orderSheet.headerValues.indexOf('isCompleted');
  if (_isCompletedColIdx === -1) throw new Error('isCompleted 컬럼을 시트 헤더에서 찾을 수 없습니다.');

  _orderRowMap = new Map();
  for (let i = 1; i < _orderRows.length; i++) {
    const id = _orderRows[i].orderID;
    if (id) _orderRowMap.set(String(id), i);
  }
  console.log(`기존 주문 ${_orderRowMap.size}건 확인`);
}

async function _writeOrderRow(orderDetail) {
  for (let i = 1; i < _orderRows.length; i++) {
    if (!_orderRows[i].orderID) {
      _orderRows[i].orderID          = String(orderDetail.orderID);
      _orderRows[i]['1acSku']        = orderDetail['1acSku']        || '';
      _orderRows[i].peculiarities    = orderDetail.peculiarities    || '';
      _orderRows[i].productColor     = orderDetail.productColor     || '';
      _orderRows[i].productCount     = orderDetail.productCount     || '';
      _orderRows[i].productURL       = orderDetail.productURL       || '';
      _orderRows[i].productOrderDate = orderDetail.productOrderDate || '';
      await _orderRows[i].save();
      _orderRowMap.set(String(orderDetail.orderID), i);
      console.log(`시트 ${i + 2}행에 기록 완료: 주문 ID ${orderDetail.orderID}`);
      break;
    }
  }
}

async function googleOrderSheet(orderID, orderName) {
  try {
    await _initOrderSheet();

    console.log(`Google Sheets 처리 시작: 주문 ID ${orderID}`);

    if (_orderRowMap.has(String(orderID))) {
      console.log(`이미 존재하는 주문, 스킵: ${orderID}`);
      return;
    }

    const orderDetailObjectArray = await shopifyOrderDetail(orderID);
    for (const orderDetail of orderDetailObjectArray) {
      await _writeOrderRow(orderDetail);
    }
  } catch (error) {
    console.error(`구글 시트 처리 중 오류 발생 (주문 ID: ${orderID}):`, error.message);

    if (error.response && error.response.status === 429) {
      console.log(`할당량 초과, 10초 후 재시도: 주문 ID ${orderID}`);
      await delay(10000);
      try {
        return await googleOrderSheet(orderID, orderName);
      } catch (retryError) {
        console.error(`재시도 실패 (주문 ID: ${orderID}):`, retryError.message);
        throw retryError;
      }
    }

    throw error;
  }
}

async function markCompletedByOrderIds(shopifyOrderIds) {
  await _initOrderSheet();
  const idSet = new Set(shopifyOrderIds.map(String));

  const targets = [];
  for (const [orderId, row] of _orderRowMap) {
    if (idSet.has(orderId)) targets.push({ orderId, row });
  }

  if (targets.length === 0) {
    console.log('완료 표시할 주문 없음');
    return;
  }

  // _orderRows 인덱스(i) → 1-indexed 시트 행: i+2
  const minSheetRow = Math.min(...targets.map(t => t.row)) + 2;
  const maxSheetRow = Math.max(...targets.map(t => t.row)) + 2;
  const colLetter = colIndexToLetter(_isCompletedColIdx);
  await _orderSheet.loadCells(`${colLetter}${minSheetRow}:${colLetter}${maxSheetRow}`);

  let updatedCount = 0;
  for (const { orderId, row } of targets) {
    // _orderRows 인덱스(i) → 0-indexed 시트 행: i+1
    const cell = _orderSheet.getCell(row + 1, _isCompletedColIdx);
    if (cell.value === true) continue;
    cell.value = true;
    updatedCount++;
    console.log(`✅ ${row + 2}행 완료 표시 예정 (orderID: ${orderId})`);
  }

  if (updatedCount > 0) {
    await _orderSheet.saveUpdatedCells();
    console.log(`✅ ${updatedCount}건 완료 표시 완료`);
  } else {
    console.log('새로 완료 표시할 주문 없음 (모두 이미 처리됨)');
  }
}

module.exports.googleOrderSheet = googleOrderSheet;
module.exports.markCompletedByOrderIds = markCompletedByOrderIds;
