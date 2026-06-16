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

// 컬럼 매핑 (0-indexed)
const COL = {
  isCompleted:      0, // A열 — 체크박스
  orderID:          1, // B열
  '1acSku':         2, // C열
  peculiarities:    3, // D열
  productColor:     4, // E열
  productCount:     5, // F열
  productURL:       6, // G열
  productOrderDate: 7, // H열
};
// 데이터 시작 행 (0-indexed): 시트 1행=헤더, 2행=네임행, 3행부터 데이터
const FIRST_DATA_ROW = 2;

let _orderSheet = null;
let _existingOrderIDs = null;
let _nextDataRow = null;
let _orderRowMap = null; // orderID → row 인덱스(0-indexed)

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

  const lastRow = _orderSheet.rowCount;
  // B열(orderID)만 스캔해서 기존 데이터 파악
  await _orderSheet.loadCells(`B${FIRST_DATA_ROW + 1}:B${lastRow}`);

  _existingOrderIDs = new Set();
  _orderRowMap = new Map();
  _nextDataRow = FIRST_DATA_ROW;

  for (let row = FIRST_DATA_ROW; row < lastRow; row++) {
    const val = _orderSheet.getCell(row, COL.orderID).value;
    if (val !== null && val !== undefined && val !== '') {
      _existingOrderIDs.add(String(val));
      _orderRowMap.set(String(val), row);
      _nextDataRow = row + 1;
    }
  }
  console.log(`기존 주문 ${_existingOrderIDs.size}건 확인, 다음 기록 행: ${_nextDataRow + 1}행`);
}

async function _writeOrderRow(orderDetail) {
  const row = _nextDataRow;
  const sheetRow = row + 1; // 표시용 1-indexed

  // 해당 행만 로드 후 셀 직접 지정
  await _orderSheet.loadCells(`B${sheetRow}:H${sheetRow}`);

  _orderSheet.getCell(row, COL.orderID).value          = String(orderDetail.orderID);
  _orderSheet.getCell(row, COL['1acSku']).value         = orderDetail['1acSku'] || '';
  _orderSheet.getCell(row, COL.peculiarities).value     = orderDetail.peculiarities || '';
  _orderSheet.getCell(row, COL.productColor).value      = orderDetail.productColor || '';
  _orderSheet.getCell(row, COL.productCount).value      = orderDetail.productCount || '';
  _orderSheet.getCell(row, COL.productURL).value        = orderDetail.productURL || '';
  _orderSheet.getCell(row, COL.productOrderDate).value  = orderDetail.productOrderDate || '';

  await _orderSheet.saveUpdatedCells();
  _existingOrderIDs.add(String(orderDetail.orderID));
  _nextDataRow++;
  console.log(`시트 ${sheetRow}행에 기록 완료: 주문 ID ${orderDetail.orderID}`);
}

async function googleOrderSheet(orderID, orderName) {
  try {
    await _initOrderSheet();

    console.log(`Google Sheets 처리 시작: 주문 ID ${orderID}`);

    if (_existingOrderIDs.has(String(orderID))) {
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

  // 업데이트 대상 행 수집
  const targets = [];
  for (const [orderId, row] of _orderRowMap) {
    if (idSet.has(orderId)) targets.push({ orderId, row });
  }

  if (targets.length === 0) {
    console.log('완료 표시할 주문 없음');
    return;
  }

  // isCompleted 열을 대상 범위만큼 한 번에 로드 (read 1회)
  const minRow = Math.min(...targets.map(t => t.row));
  const maxRow = Math.max(...targets.map(t => t.row));
  const colLetter = colIndexToLetter(COL.isCompleted);
  await _orderSheet.loadCells(`${colLetter}${minRow + 1}:${colLetter}${maxRow + 1}`);

  // 메모리에서 전부 업데이트
  let updatedCount = 0;
  for (const { orderId, row } of targets) {
    const cell = _orderSheet.getCell(row, COL.isCompleted);
    if (cell.value === true) continue; // 이미 완료
    cell.value = true;
    updatedCount++;
    console.log(`✅ ${row + 1}행 완료 표시 예정 (orderID: ${orderId})`);
  }

  // 한 번에 저장 (write 1회)
  if (updatedCount > 0) {
    await _orderSheet.saveUpdatedCells();
    console.log(`✅ ${updatedCount}건 완료 표시 완료`);
  } else {
    console.log('새로 완료 표시할 주문 없음 (모두 이미 처리됨)');
  }
}

module.exports.googleOrderSheet = googleOrderSheet;
module.exports.markCompletedByOrderIds = markCompletedByOrderIds;
