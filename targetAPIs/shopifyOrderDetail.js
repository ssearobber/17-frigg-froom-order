const path = require('path');
const { googleProfitSheet } = require('./googleProfitSheet');
const { shopifyOrderItemsObject } = require('./shopifyOrderList');

// shopify 주문정보 상세
async function shopifyOrderDetail(orderID) {
  let orderDetailObjectArray = [];

  try {
    const { orders } = await shopifyOrderItemsObject();
    // orders를 동기적으로 처리하기 위해 for...of 사용
    for (let item of orders) {
      if (item.id == orderID) {
        console.log("대상 주문ID : ", orderID);
        for (let i = 0; i < item.line_items.length; i++) {
          // 새 객체를 반복문의 각 단계에서 생성
          let orderDetailObject = {
            productOrderDate: removeAfterT(item.created_at),
            productId: item.line_items[i].product_id,
            productCount: item.line_items[i].quantity,
            productColor: item.line_items[i].variant_title,
            productCustomerENName: item.shipping_address?.name,
            productCustomerPostalCode: item.shipping_address?.zip,
            productCustomerENAddress: (item.shipping_address?.province ?? "") + (item.shipping_address?.city ?? "") + (item.shipping_address?.address1 ?? "") + (item.shipping_address?.address2 ?? ""),
            productDeliveryMethod: 'KSE',
          };

          console.log('구글 시트(利益計算)에서 정보 취득');
          let googleProfitObject = await googleProfitSheet(orderDetailObject.productId);
          console.log('구글 시트(利益計算)에서 정보 취득 종료');
          console.log('googleProfitObject:', JSON.stringify(googleProfitObject, null, 2));

          // 나머지 속성 설정
          orderDetailObject.rowNum = googleProfitObject.rowNum;
          orderDetailObject.productURL = googleProfitObject.productURL;
          orderDetailObject.productProfit = googleProfitObject.shopifyProfit * orderDetailObject.productCount;
          orderDetailObject.orderID = orderID;
          orderDetailObject.peculiarities = googleProfitObject.peculiarities;
          orderDetailObject.productProfitRate = googleProfitObject.shopifyProfitRate;

          console.log('주문정보 상세 종료.');

          orderDetailObjectArray.push(orderDetailObject);
        }
      }
    }
    return orderDetailObjectArray;
  } catch (e) {
    console.error(e);
    return []; // 에러가 발생한 경우 빈 배열 반환
  }
}

function removeAfterT(str) {
  return str.split('T')[0];
}

module.exports.shopifyOrderDetail = shopifyOrderDetail;
