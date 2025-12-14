const { GoogleSpreadsheet } = require('google-spreadsheet');

async function googleProfitSheet(productId) {
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
  const sheet = doc.sheetsById[process.env.GOOGLE_PROFIT_SHEET_ID || googleProfitSheetId];

  // rows 취득
  const rows = await sheet.getRows();

  // 해당 상품ID의 row번호, url을 취득
  let googleProfitObject = {};
  for (i = 1; i < rows.length; i++) {
    if (!rows[i].shopifyProductId) continue;
    // 해당 상품ID가 존재하는 row
    if (rows[i].shopifyProductId.match(/\d{13}/g) == productId) {
      googleProfitObject.rowNum = i + 2;
      googleProfitObject.peculiarities = rows[i].peculiarities;
      googleProfitObject.productURL = rows[i].productURL;
      googleProfitObject.shopifyProfit = rows[i].shopifyProfit.replace(/[^0-9]/g, '');
      googleProfitObject.shopifyProfitRate = rows[i].shopifyProfitRate;
    }
  }

  return googleProfitObject;
}

module.exports.googleProfitSheet = googleProfitSheet;
