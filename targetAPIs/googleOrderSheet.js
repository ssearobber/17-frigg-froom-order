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
let _orderRowMap       = null;    // orderID → 0-indexed 시트 행
let _availableRows     = null;    // _orderRows 내 빈 행의 0-indexed 시트 행 큐
let _nextAppendRow0    = null;    // _orderRows 범위 밖 추가 위치 (0-indexed)
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

  _isCompletedColIdx = _orderSheet.headerValues.indexOf('isCompleted');
  if (_isCompletedColIdx === -1) throw new Error('isCompleted 컬럼을 시트 헤더에서 찾을 수 없습니다.');

  _orderRowMap   = new Map();
  _availableRows = [];
  for (let i = 1; i < _orderRows.length; i++) {
    const id = _orderRows[i].orderID;
    if (id) {
      // 0-indexed 시트 행 저장 (_orderRows[i] ↔ 0-indexed i+1)
      _orderRowMap.set(String(id), i + 1);
    } else {
      // orderID가 없는 빈 행 → 사용 가능 큐에 추가
      _availableRows.push(i + 1);
    }
  }
  // _orderRows[N-1] ↔ 0-indexed N, 다음 행 = N+1
  _nextAppendRow0 = _orderRows.length + 1;
  console.log(`기존 주문 ${_orderRowMap.size}건 확인`);
}

async function _writeOrderRow(orderDetail) {
  // 빈 행 우선 사용 → 없으면 _orderRows 범위 밖 행에 추가
  const targetRow0 = _availableRows.length > 0
    ? _availableRows.shift()
    : _nextAppendRow0++;
  const targetRow1 = targetRow0 + 1; // 1-indexed (loadCells 범위용)

  const lastColLetter = colIndexToLetter(_orderSheet.headerValues.length - 1);
  await _orderSheet.loadCells(`A${targetRow1}:${lastColLetter}${targetRow1}`);

  // 헤더명으로 열 인덱스를 취득해 값만 설정 (포맷 유지)
  const setVal = (name, value) => {
    const idx = _orderSheet.headerValues.indexOf(name);
    if (idx !== -1) _orderSheet.getCell(targetRow0, idx).value = value ?? '';
  };
  // 숫자형 필드: string으로 넣으면 Sheets가 ' apostrophe prefix를 붙이므로 Number로 변환
  const setNum = (name, value) => {
    const idx = _orderSheet.headerValues.indexOf(name);
    if (idx === -1) return;
    const num = Number(value);
    _orderSheet.getCell(targetRow0, idx).value = value !== '' && value != null && !isNaN(num) ? num : (value ?? '');
  };

  setVal('orderID',          String(orderDetail.orderID));
  setVal('1acSku',           orderDetail['1acSku']        || '');
  setVal('peculiarities',    orderDetail.peculiarities    || '');
  setVal('productColor',     orderDetail.productColor     || '');
  setNum('productCount',     orderDetail.productCount     ?? '');
  setVal('productURL',       orderDetail.productURL       || '');
  setVal('productOrderDate', orderDetail.productOrderDate || '');

  await _orderSheet.saveUpdatedCells();
  _orderRowMap.set(String(orderDetail.orderID), targetRow0);
  console.log(`시트 ${targetRow1}행에 기록 완료: 주문 ID ${orderDetail.orderID}`);
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

  // row = 0-indexed → 1-indexed = row+1
  const minSheetRow = Math.min(...targets.map(t => t.row)) + 1;
  const maxSheetRow = Math.max(...targets.map(t => t.row)) + 1;
  const colLetter = colIndexToLetter(_isCompletedColIdx);
  await _orderSheet.loadCells(`${colLetter}${minSheetRow}:${colLetter}${maxSheetRow}`);

  let updatedCount = 0;
  for (const { orderId, row } of targets) {
    const cell = _orderSheet.getCell(row, _isCompletedColIdx);
    if (cell.value === true) continue;
    cell.value = true;
    updatedCount++;
    console.log(`✅ ${row + 1}행 완료 표시 예정 (orderID: ${orderId})`);
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
