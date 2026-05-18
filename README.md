# table-block (검증용 frontend)

`table-block-doc` 의 코어 모델(Table 3종 + Interceptor + DAG + 룰 캐스케이드)을 직접 그려보고 실행해 검증하기 위한 단일 페이지 앱입니다.

## 스택

- Next.js (App Router) + TypeScript
- Tailwind CSS
- React Flow (n8n 풍 드래그/드롭 캔버스)
- DB 없이 `data/flow.json` 로컬 파일에 상태 저장

## 실행

```bash
npm install
npm run dev
# http://localhost:3000
```

## 페이지 구성 (단일 페이지)

```
┌──────────────────────────────────────────────────────────────┐
│ Top:   [▶ Run Flow]  [💾 Save]  [↻ Reload]                  │
├─────────┬────────────────────────────────────────────────────┤
│ Palette │  React Flow Canvas                                 │
│ Dynamic │  - 드래그/드롭으로 노드 추가                       │
│ CRUD    │  - 핸들을 끌어 edge 연결                           │
│ Derived │  - 노드 클릭 → 중앙 모달로 설정 편집               │
│ Intercep│  - edge/노드 선택 후 Del 로 해제                   │
├─────────┴────────────────────────────────────────────────────┤
│ Logs / Tables (Run 결과)                                     │
└──────────────────────────────────────────────────────────────┘
```

## 모델 → UI 매핑

| 문서                                       | UI                                                |
|--------------------------------------------|---------------------------------------------------|
| `Source = Fetch(f, params)` (Dynamic)      | fetchUrl + params + schema                        |
| `Source = State(S, ops, opts)` (CRUD)      | rows(JSON) + history/audit 토글                   |
| `Source = Derive(rowGen, cellRules, deps)` | ① rowGen(KeysFrom/Union/Filter) ② cellRules(pick/formula/cases) |
| `Interceptor = (deps, guard, eff, m)`      | mode(pass/block-on-fail/filter) + guard + effect  |
| DAG acyclic                                | Run 시 토포 정렬, 사이클이면 에러                 |

MVP 스코프와 결정 로그는 [docs/mvp.md](docs/mvp.md).

## API

- `GET  /api/flow` → 저장된 flow 문서 로드 (없으면 기본 샘플)
- `POST /api/flow` → flow 문서 저장 (`data/flow.json`)
- `POST /api/run`  → 주어진 flow를 토포 정렬해 실행, `{ logs, tables }` 반환
