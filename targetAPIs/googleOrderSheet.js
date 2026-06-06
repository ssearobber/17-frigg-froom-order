const { GoogleSpreadsheet } = require('google-spreadsheet');
const { shopifyOrderDetail } = require('./shopifyOrderDetail');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 컬럼 매핑 (0-indexed)
const COL = {
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

async function _initOrderSheet() {
  if (_orderSheet !== null) return;

  if (!process.env.GOOGLE_SPREAD_ID) throw new Error('GOOGLE_SPREAD_ID 환경변수가 설정되지 않았습니다.');
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL 환경변수가 설정되지 않았습니다.');
  if (!process.env.GOOGLE_PRIVATE_KEY) throw new Error('GOOGLE_PRIVATE_KEY 환경변수가 설정되지 않았습니다.');
  if (!process.env.GOOGLE_ORDER_SHEET_ID) throw new Error('GOOGLE_ORDER_SHEET_ID 환경변수가 설정되지 않았습니다.');

  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SPREAD_ID);
  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY,
  });
  await doc.loadInfo();
  _orderSheet = doc.sheetsById[process.env.GOOGLE_ORDER_SHEET_ID];

  const lastRow = _orderSheet.rowCount;
  // B열(orderID)만 스캔해서 기존 데이터 파악
  await _orderSheet.loadCells(`B${FIRST_DATA_ROW + 1}:B${lastRow}`);

  _existingOrderIDs = new Set();
  _nextDataRow = FIRST_DATA_ROW;

  for (let row = FIRST_DATA_ROW; row < lastRow; row++) {
    const val = _orderSheet.getCell(row, COL.orderID).value;
    if (val !== null && val !== undefined && val !== '') {
      _existingOrderIDs.add(String(val));
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

module.exports.googleOrderSheet = googleOrderSheet;
