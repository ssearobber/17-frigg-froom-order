const { GoogleSpreadsheet } = require('google-spreadsheet');
const { shopifyOrderDetail } = require('./shopifyOrderDetail');

// Google Sheets API 속도 제한을 위한 지연 함수
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// API 호출 간격 제어 (1초 간격)
const API_CALL_DELAY = 1000;

async function googleOrderSheet(orderID, orderName) {
  // API 호출 제한을 위한 지연
  await delay(API_CALL_DELAY);
  
  try {
    // 환경변수 확인
    if (!process.env.GOOGLE_SPREAD_ID) {
      throw new Error('GOOGLE_SPREAD_ID 환경변수가 설정되지 않았습니다.');
    }
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL 환경변수가 설정되지 않았습니다.');
    }
    if (!process.env.GOOGLE_PRIVATE_KEY) {
      throw new Error('GOOGLE_PRIVATE_KEY 환경변수가 설정되지 않았습니다.');
    }
    if (!process.env.GOOGLE_ORDER_SHEET_ID) {
      throw new Error('GOOGLE_ORDER_SHEET_ID 환경변수가 설정되지 않았습니다.');
    }

    console.log(`Google Sheets 처리 시작: 주문 ID ${orderID}`);
    
    // 시트 url중 값
    // Initialize the sheet - doc ID is the long id in the sheets URL
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SPREAD_ID || googleSpreadId);

  // GOOGLE_API_KEY로 구글API다루는 방법. 읽는것만 가능.
  // doc.useApiKey(process.env.GOOGLE_API_KEY);

  // GOOGLE_SERVICE로 구글API다루는 방법. 편집 가능.
  // Initialize Auth - see more available options at https://theoephraim.github.io/node-google-spreadsheet/#/getting-started/authentication
  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || googleServiceAccountEmail,
    private_key: process.env.GOOGLE_PRIVATE_KEY || googlePrivateKey,
  });

  // loads document properties and worksheets
  await doc.loadInfo();

  // the buymaList 시트ID로 시트취득
  const sheet = doc.sheetsById[process.env.GOOGLE_ORDER_SHEET_ID || googleOrderSheetId];

  // rows 취득
  const rows = await sheet.getRows();

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
            rows[i].productProfitRate = orderDetailObjectArray[j].shopifyProfitRate;
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

// 재시도용 함수 (간단화된 버전)
async function googleOrderSheetRetry(orderID, orderName) {
  console.log(`재시도 함수 실행: 주문 ID ${orderID}`);
  
  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SPREAD_ID || googleSpreadId);
  
  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || googleServiceAccountEmail,
    private_key: process.env.GOOGLE_PRIVATE_KEY || googlePrivateKey,
  });

  await doc.loadInfo();
  const sheet = doc.sheetsById[process.env.GOOGLE_ORDER_SHEET_ID || googleOrderSheetId];
  const rows = await sheet.getRows();

  // 간단한 중복 확인만 수행
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].orderID == orderID && rows[i].orderName == orderName) {
      console.log(`재시도: 이미 존재하는 주문 (ID: ${orderID})`);
      return;
    }
  }
  
  console.log(`재시도: 새로운 주문 처리 필요 (ID: ${orderID})`);
  // 여기서는 간단히 로그만 남기고 실제 처리는 나중에 수행
}

module.exports.googleOrderSheet = googleOrderSheet;
