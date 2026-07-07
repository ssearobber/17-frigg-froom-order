const mysql = require('mysql2/promise');

// OrderItem.id는 "line-item-{Shopify 라인아이템 숫자ID}" 형식으로 생성됨 (swoo-integration/kse-app 공통)
function toLineItemId(orderItemId) {
  return String(orderItemId).replace(/^line-item-/, '');
}

// notifiedAt이 설정된(= 이메일 발송 완료) 레코드의 "orderID_lineItemId" 복합키 목록 반환
async function getNotifiedOrderItemKeys() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await conn.execute(`
    SELECT DISTINCT o.shopifyOrderId, oi.id AS orderItemId
    FROM CarrierTrackingStatus cts
    JOIN FulfillmentRecord fr ON cts.fulfillmentRecordId = fr.id
    JOIN OrderItem oi ON fr.orderItemId = oi.id
    JOIN \`Order\` o ON oi.orderId = o.id
    WHERE cts.notifiedAt IS NOT NULL
  `);
  await conn.end();
  return rows
    .filter(r => r.shopifyOrderId)
    .map(r => `${r.shopifyOrderId}_${toLineItemId(r.orderItemId)}`);
}

module.exports = { getNotifiedOrderItemKeys };
