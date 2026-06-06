const { GoogleSpreadsheet } = require('google-spreadsheet');

// 프로세스 실행 동안 rows를 캐싱하여 반복 API 호출 방지
let _profitRows = null;

async function _initProfitRows() {
  if (_profitRows) return;
  const doc = new GoogleSpreadsheet(process.env.GOOGLE_PROFIT_SPREAD_ID);
  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  });
  await doc.loadInfo();
  const sheet = doc.sheetsById[process.env.GOOGLE_PROFIT_SHEET_ID];
  _profitRows = await sheet.getRows();
}

async function googleProfitSheet(productId) {
  // 첫 호출 시에만 API 요청, 이후는 캐시 사용
  await _initProfitRows();

  // 해당 상품ID의 row번호, url을 취득
  let googleProfitObject = {};
  for (i = 1; i < _profitRows.length; i++) {
    if (!_profitRows[i].shopifyProductId) continue;
    // 해당 상품ID가 존재하는 row
    if (_profitRows[i].shopifyProductId.match(/\d{13}/g) == productId) {
      googleProfitObject.rowNum = i + 2;
      googleProfitObject['1acSku'] = _profitRows[i]['1acSku'];
      googleProfitObject.peculiarities = _profitRows[i].peculiarities;
      googleProfitObject.productURL = _profitRows[i].productURL;
      googleProfitObject.shopifyProfit = _profitRows[i].shopifyProfit.replace(/[^0-9]/g, '');
      googleProfitObject.shopifyProfitRate = _profitRows[i].shopifyProfitRate;

      console.log(`상품 ID ${productId} 찾음:`);
      console.log(`- Row: ${i + 2}`);
      console.log(`- shopifyProfitRate 원본 값:`, _profitRows[i].shopifyProfitRate);
      console.log(`- shopifyProfitRate 타입:`, typeof _profitRows[i].shopifyProfitRate);
    }
  }

  return googleProfitObject;
}

module.exports.googleProfitSheet = googleProfitSheet;
