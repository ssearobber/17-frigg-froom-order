const mysql = require('mysql2/promise');

// notifiedAt이 설정된(= 이메일 발송 완료) 레코드의 Shopify 주문ID 목록 반환
async function getNotifiedShopifyOrderIds() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await conn.execute(`
    SELECT DISTINCT o.shopifyOrderId
    FROM CarrierTrackingStatus cts
    JOIN FulfillmentRecord fr ON cts.fulfillmentRecordId = fr.id
    JOIN OrderItem oi ON fr.orderItemId = oi.id
    JOIN \`Order\` o ON oi.orderId = o.id
    WHERE cts.notifiedAt IS NOT NULL
  `);
  await conn.end();
  return rows.map(r => r.shopifyOrderId).filter(Boolean);
}

module.exports = { getNotifiedShopifyOrderIds };
