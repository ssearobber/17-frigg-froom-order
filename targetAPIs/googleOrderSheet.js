const { GoogleSpreadsheet } = require('google-spreadsheet');
const { shopifyOrderDetail } = require('./shopifyOrderDetail');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 프로세스 실행 동안 시트 연결과 rows를 캐싱하여 반복 API 호출 방지
let _orderSheet = null;
let _orderRows = null;

async function _initOrderSheet() {
  if (_orderSheet && _orderRows) return;

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
  _orderRows = await _orderSheet.getRows();
}

async function googleOrderSheet(orderID, orderName) {
  try {
    // 첫 호출 시에만 API 요청, 이후는 캐시 사용
    await _initOrderSheet();

    console.log(`Google Sheets 처리 시작: 주문 ID ${orderID}`);

  // rows 취득 (캐시된 배열 사용)
  const rows = _orderRows;

  // 구글 시트(受注list)에 주문ID가 존재하는지 확인
  let orderDetailObjectArray;
  let isOrderID = false;
  for (i = 1; i < rows.length; i++) {
    // 구글 시트(受注list)에 주문ID가 존재하는 경우 패스
    if (rows[i].orderID == orderID && rows[i].orderName == orderName) {
      isOrderID = true;
      break;
    }
  }
  // buyma 주문 상세페이지에서 정보 취득
  // 구글 시트(利益計算)에서 값을 취득 함
  if (!isOrderID) {
    //FIXME: 쇼피파이의 api를 여러번 부를필요가 없음. -> 나중에 매게변수로 전달 받기.
    orderDetailObjectArray = await shopifyOrderDetail(orderID);
    if(orderDetailObjectArray.length > 0) {
      for (j = 0; j < orderDetailObjectArray.length; j++) {
        // 구글 시트(受注list)에 값입력
        for (i = 1; i < rows.length; i++) {
          // row 추가
          if (!rows[i].orderID && !rows[i].orderName) {
            rows[i].orderName = orderName;
            rows[i].orderID = orderDetailObjectArray[j].orderID;
            rows[i].productOrderDate = orderDetailObjectArray[j].productOrderDate;
            rows[i].peculiarities = orderDetailObjectArray[j].peculiarities;
            rows[i].rowNum = orderDetailObjectArray[j].rowNum;
            rows[i].productURL = orderDetailObjectArray[j].productURL;
            rows[i].productCount = orderDetailObjectArray[j].productCount;
            rows[i].productColor = orderDetailObjectArray[j].productColor;
            rows[i].productDeliveryMethod = orderDetailObjectArray[j].productDeliveryMethod;
            rows[i].productCustomerENName = orderDetailObjectArray[j].productCustomerENName;
            rows[i].productCustomerPostalCode = orderDetailObjectArray[j].productCustomerPostalCode;
            rows[i].productCustomerENAddress = orderDetailObjectArray[j].productCustomerENAddress;
            rows[i].productProfit = orderDetailObjectArray[j].productProfit;
            rows[i].productDeadlineDate = orderDetailObjectArray[j].productDeadlineDate;
            rows[i].productId = orderDetailObjectArray[j].productId;
            rows[i].productProfitRate = orderDetailObjectArray[j].productProfitRate;
            rows[i].save();
            break;
          }
        }
      }
    }  
  }
  } catch (error) {
    console.error(`구글 시트 처리 중 오류 발생 (주문 ID: ${orderID}):`, error.message);
    
    // 429 오류 (할당량 초과) 시 재시도 로직
    if (error.response && error.response.status === 429) {
      console.log(`할당량 초과로 인한 재시도: 주문 ID ${orderID}, 10초 후 재시도...`);
      await delay(10000); // 10초 대기
      
      try {
        // 재시도 (한 번만)
        console.log(`재시도 실행: 주문 ID ${orderID}`);
        return await googleOrderSheetRetry(orderID, orderName);
      } catch (retryError) {
        console.error(`재시도 실패 (주문 ID: ${orderID}):`, retryError.message);
        throw retryError;
      }
    }
    
    throw error;
  }
}

// 재시도용 함수 — 캐시된 연결 재사용
async function googleOrderSheetRetry(orderID, orderName) {
  console.log(`재시도 함수 실행: 주문 ID ${orderID}`);

  // _initOrderSheet()는 이미 완료된 상태이므로 캐시된 rows 사용
  const rows = _orderRows;

  // 간단한 중복 확인만 수행
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].orderID == orderID && rows[i].orderName == orderName) {
      console.log(`재시도: 이미 존재하는 주문 (ID: ${orderID})`);
      return;
    }
  }

  console.log(`재시도: 새로운 주문 처리 필요 (ID: ${orderID})`);
}

module.exports.googleOrderSheet = googleOrderSheet;
