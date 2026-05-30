# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 언어 규칙

코드 주석, 커밋 메시지, 인라인 설명은 모두 **한국어**로 작성한다.

## 실행 명령

```bash
npm install
npm start       # 1회 실행 (Heroku Scheduler 배포 방식과 동일)
npm run dev     # nodemon 개발 모드
```

테스트 없음. 동작 확인은 로컬에서 `npm run dev` 실행 후 로그로 검증한다.

## 아키텍처

**Heroku Scheduler에 배포되어 주기적으로 1회 실행되는 배치 스크립트**다. 매 실행마다 새 프로세스가 시작되어 Shopify 주문을 Google Sheets에 동기화한다.

### 처리 흐름

```
server.js
  └─ shopifyOrderList.shopifyOrderIdObject()   → Shopify에서 주문 ID 목록 취득
  └─ (순차 루프) googleOrderSheet(id, name)
        └─ googleOrderSheet.js (캐시 초기화: _initOrderSheet)
              └─ sheet.getRows() → 이미 존재하는 주문이면 스킵
              └─ shopifyOrderDetail(orderID)
                    └─ shopifyOrderList.shopifyOrderItemsObject()  → 전체 주문 상세 취득
                    └─ (line_item 루프) googleProfitSheet(productId)
                          └─ googleProfitSheet.js (캐시 초기화: _initProfitRows)
                              → 수익 시트에서 상품별 이익·수익률 조회
              └─ rows[i].save()  → 주문 시트에 신규 행 저장
```

### 핵심 설계 결정: Google Sheets 캐싱

`googleOrderSheet.js`와 `googleProfitSheet.js`는 모두 **모듈 레벨 캐시** (`_orderRows`, `_profitRows`)를 사용한다. 프로세스 실행 중 첫 번째 호출에서만 `loadInfo()` + `getRows()` API를 호출하고, 이후 모든 주문 처리는 캐시를 재사용한다. Google Sheets Read 할당량(300회/분) 초과를 방지하기 위한 구조다.

- `_orderRows` 캐시는 쓰기 시 `rows[i].save()`로 in-memory 객체를 직접 수정하므로 캐시 상태가 실제 시트와 동기화된다.
- `_profitRows` 캐시는 읽기 전용이므로 실행 내내 안전하게 재사용된다.

### 파일별 역할

| 파일 | 역할 |
|------|------|
| `server.js` | 진입점. 주문 ID 목록을 가져와 순차 처리 루프 실행 |
| `targetAPIs/axiosinstances.js` | Shopify Admin API용 axios 인스턴스 (인증 헤더 포함) |
| `targetAPIs/shopifyOrderList.js` | Shopify API 2023-10/2024-01 엔드포인트 호출. `shopifyOrderIdObject` (ID·name만), `shopifyOrderItemsObject` (전체 상세) |
| `targetAPIs/shopifyOrderDetail.js` | line_item별 주문 상세 객체 조립. 각 line_item마다 `googleProfitSheet()` 호출 |
| `targetAPIs/googleOrderSheet.js` | 주문 추적 시트 읽기/쓰기. 캐시 관리 포함 |
| `targetAPIs/googleProfitSheet.js` | 수익 시트에서 `shopifyProductId`로 이익·수익률 조회. 캐시 관리 포함 |

## 환경변수

`env.example`을 복사해 `.env`를 만든다. `env.example`에 없지만 코드에서 필요한 변수:

```
GOOGLE_PROFIT_SHEET_ID=수익_시트의_gid_값
```

## 주의사항

- `shopifyOrderItemsObject()`는 `status=any`로 **전체 주문**을 매 루프마다 다시 가져온다. 주문 수가 많아지면 성능 병목이 된다 (FIXME 주석 참고).
- `google-spreadsheet` v3.1.15는 명시적 close API가 없다. 인스턴스를 새로 생성하면 `[DEP0137]` FileHandle GC 경고가 발생하므로, 반드시 캐시된 인스턴스를 재사용해야 한다.
- Shopify API 버전이 `shopifyOrderIdObject`(2023-10)와 `shopifyOrderItemsObject`(2024-01)에서 다르게 설정되어 있다.
