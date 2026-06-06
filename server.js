const { shopifyOrderIdObject } = require('./targetAPIs/shopifyOrderList');
const { googleOrderSheet } = require('./targetAPIs/googleOrderSheet');
require('dotenv').config();

// 비동기용 asyncForEach 함수 생성
Array.prototype.asyncForEach = async function (callback) {
	for (let index = 0; index < this.length; index++) {
		await callback(this[index], index, this);
	}
};

// shopify의 주문ID를 취득
async function main() {
  try {
    const orderIDArray = await shopifyOrderIdObject("id","name");
    
    // 受注가 없다면 프로그램 종료
    if (orderIDArray.orders.length === 0) {
      console.log('주문이 없습니다. 프로그램을 종료합니다.');
      process.exit(0);
    }

    // 오래된 주문부터 위 행에 기록되도록 오름차순 정렬
    const orders = [...orderIDArray.orders].reverse();

    console.log(`${orders.length}개의 주문을 처리합니다.`);

    console.log('주문들을 순차적으로 처리합니다 (API 할당량 보호)...');

    for (let i = 0; i < orders.length; i++) {
      const orderIDObject = orders[i];
      console.log(`[${i + 1}/${orders.length}] 주문 처리 중: ${orderIDObject.name} (ID: ${orderIDObject.id})`);
      
      try {
        await googleOrderSheet(orderIDObject.id, orderIDObject.name);
        console.log(`✅ 완료: ${orderIDObject.name}`);
      } catch (error) {
        console.error(`❌ 실패: ${orderIDObject.name} - ${error.message}`);
        // 개별 주문 실패 시에도 다음 주문 계속 처리
      }
    }

    console.log('모든 주문 처리가 완료되었습니다.');
  } catch (error) {
    console.error('오류 발생:', error.message);
    console.error('상세 오류:', error);
    process.exit(1);
  }
}

main();


