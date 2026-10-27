# BadgeToken — ERC-1155 배지 dApp (전송 차단)

> **⚠️ 레거시 저장소입니다. 메인은 [`onchain-contract`](https://github.com/Gated-1155/onchain-contract)입니다.**
> 이 저장소는 같은 컨트랙트의 초기 버전(viem + `node:test`)으로, 배지 ID별 `transferable` 플래그를 쓰던 시기의 구현이며 비교·기록용으로만 남겨 두었습니다. 최신 설계(컨트랙트 전체 단일 스위치)와 배포 주소, 프론트엔드는 `onchain-contract`와 [`onchain-client`](https://github.com/Gated-1155/onchain-client)를 참고하세요.
> 아래 배포된 컨트랙트는 메타데이터 URI가 이전 조직 주소를 가리키고 있어, 배지 이름/이미지가 표시되지 않을 수 있습니다.

배지 ID별로 `transferable` 플래그를 가진 ERC-1155 컨트랙트. 플래그가 `false`인 배지는 직접 전송·배치 전송·operator 경유 전송 어떤 경로로도 옮길 수 없다. 상세 설계 근거와 전송 경로 조사·실패 시나리오는 프로젝트 Notion 문서 참고.

## Polygon Amoy 배포 정보

- **컨트랙트 주소**: [`0xe2701e6e1219616e526fc933146c9389c9779d2e`](https://amoy.polygonscan.com/address/0xe2701e6e1219616e526fc933146c9389c9779d2e)
- **검증 상태**: Polygonscan에 "Source Code Verified / Exact Match"로 표시됨 (Sourcify 경유). Sourcify 리포지토리: https://sourcify.dev/server/repo-ui/80002/0xe2701e6e1219616e526fc933146c9389c9779d2e
- **배포 스크립트**: `scripts/deploy.ts` (`npm run deploy:amoy`)
- **생성자 인자**: `defaultAdmin`, `pauser`, `minter` — 이 배포에서는 셋 다 배포자 본인 주소로 동일하게 설정(백엔드/릴레이어 없이 관리자 지갑이 직접 서명하는 구조이므로).
---
## 프로젝트 구성

```
contracts/BadgeToken.sol           ERC-1155 배지 컨트랙트 (전송·승인 전면 차단)
contracts/test/MaliciousReceiver.sol   재진입 공격 재현용 테스트 전용 컨트랙트
test/BadgeToken.ts                 정상 동작 검증 (발행·전송차단·권한·pause 등)
test/BadgeToken.failureScenarios.ts    실패 시나리오 재현 테스트
scripts/deploy.ts                  Amoy 배포 스크립트
scripts/check-amoy-network.ts      Amoy RPC 연결 확인
scripts/check-balance.ts           배포자 잔액 확인
scripts/estimate-deploy-gas.ts     배포/민팅 gas 비용 추정
```
---
## 사용법

### 테스트

```shell
npm test          # 전체 (Solidity + TypeScript)
npm run test:ts    # TypeScript(viem)만
npm run test:sol   # Solidity만
```
---

### 타입 체크

```shell
npm run typecheck
```
---
### Amoy 배포

`.env`에 `AMOY_RPC_URL`, `PRIVATE_KEY` 필요(둘 다 이미 설정돼 있음). `BADGE_ADMIN_ADDRESS`/`BADGE_PAUSER_ADDRESS`/`BADGE_MINTER_ADDRESS`는 선택 사항 — 안 정하면 배포자 주소로 기본 설정됨.

```shell
npm run deploy:amoy
```

### Polygonscan/Sourcify 검증

```shell
npx hardhat verify --network amoy <주소> <defaultAdmin> <pauser> <minter>
```
---
## 재시작하면 어떻게 되나

**① 컨트랙트/블록체인 자체 — 해당 사항 없음.** "재시작"이라는 개념 자체가 성립하지 않습니다. 스마트 컨트랙트는 껐다 켤 수 있는 프로세스가 아니라 블록체인에 기록된 코드+상태이고, 그 상태(잔액, role, 배지 타입, `transferable` 플래그)는 우리 로컬 개발 환경이나 어떤 서버가 재시작되든 전혀 영향받지 않습니다. 이 프로젝트에는 개인키를 들고 있는 백엔드/릴레이어 서버가 없습니다 — 관리자 민팅은 관리자 본인의 지갑(MetaMask)이 wagmi를 통해 직접 서명하므로, "서버가 tx 서명 도중 죽었다"는 시나리오 자체가 존재하지 않습니다.

**② 배포 스크립트 — 재실행하면 새로 배포됩니다(주의).** `scripts/deploy.ts`는 Hardhat Ignition이 아니라 일반 `hardhat run` 스크립트라, Ignition 같은 "이미 배포된 걸 기억하는 journal"이 없습니다. 배포 스크립트가 중간에 죽어서 재실행하면, 이전 시도가 이미 성공했었더라도 **컨트랙트가 또 배포되어 새 주소가 생깁니다** — Ignition과 달리 중복 배포를 스스로 막지 않습니다. 그래서 배포 후에는 반드시 이 README에 주소를 즉시 기록해서 "어느 배포가 진짜인지" 헷갈리지 않게 해야 합니다(참고: `ignition/` 디렉터리의 예시 모듈은 Hardhat 3 템플릿이 기본 제공한 것으로, 이 프로젝트의 실제 배포엔 사용하지 않음).

**③ 프론트엔드(브라우저) — 로컬 상태는 날아가지만, 체인이 진실의 근원(source of truth)입니다.** 사용자가 민팅 tx를 보낸 직후 "대기 중" 상태를 화면에 띄워둔 채로 새로고침하면, 그 로컬 UI 상태는 사라집니다. 하지만 tx 자체는 이미 브로드캐스트됐다면 체인에 남아있으므로, 페이지를 다시 열었을 때 로컬 상태에 의존하지 말고 **지갑 주소 기준으로 배지 잔액을 다시 조회**해서 실제로 민팅이 확정됐는지/실패했는지를 재확인하는 방식으로 설계해야 합니다. (구현 단계에서 반영 예정 — 아직 UI는 작성 전.)
