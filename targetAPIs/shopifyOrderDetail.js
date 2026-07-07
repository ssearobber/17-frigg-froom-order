const { googleProfitSheet } = require('./googleProfitSheet');
const { shopifyOrderItemsObject } = require('./shopifyOrderList');

const BRAND_FILTER = ['F ROOM', 'The Frigg'];

// shopify 주문정보 상세 — F ROOM / The Frigg 브랜드 상품만 처리
async function shopifyOrderDetail(orderID) {
  let orderDetailObjectArray = [];

  try {
    const { orders } = await shopifyOrderItemsObject();
    for (let item of orders) {
      if (item.id == orderID) {
        console.log("대상 주문ID : ", orderID);
        for (let i = 0; i < item.line_items.length; i++) {
          // 브랜드 필터 — 미해당 상품은 건너뜀
          if (!BRAND_FILTER.includes(item.line_items[i].vendor)) {
            console.log(`건너뜀 (vendor: ${item.line_items[i].vendor})`);
            continue;
          }

          let orderDetailObject = {
            orderID: orderID,
            lineItemId: item.line_items[i].id,
            productOrderDate: removeAfterT(item.created_at),
            productId: item.line_items[i].product_id,
            productCount: item.line_items[i].quantity,
            productColor: item.line_items[i].variant_title,
          };

          console.log('구글 시트(利益計算)에서 정보 취득');
          let googleProfitObject = await googleProfitSheet(orderDetailObject.productId);
          console.log('구글 시트(利益計算)에서 정보 취득 종료');
          console.log('googleProfitObject:', JSON.stringify(googleProfitObject, null, 2));

          orderDetailObject['1acSku']     = googleProfitObject['1acSku'];
          orderDetailObject.peculiarities = googleProfitObject.peculiarities;
          orderDetailObject.productURL    = googleProfitObject.productURL;

          console.log('주문정보 상세 종료.');
          orderDetailObjectArray.push(orderDetailObject);
        }
      }
    }
    return orderDetailObjectArray;
  } catch (e) {
    console.error(e);
    return [];
  }
}

function removeAfterT(str) {
  return str.split('T')[0];
}

module.exports.shopifyOrderDetail = shopifyOrderDetail;
