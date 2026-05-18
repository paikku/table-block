# Frontend MVP

이 문서는 frontend(`table-block`) 가 [table-block-doc](https://github.com/paikku/table-block-doc)
의 검증 모델 중 *어디까지* 구현했는지, 그리고 *왜 그렇게* 잘랐는지를 기록한다.
문서 저장소가 모델의 진실의 원천이고, 여기는 그 모델에서 frontend MVP 가 채택한
경계의 기록.

> 코드 변경 시 이 문서를 동기화한다. doc 의 새 V-항목이 frontend 모델에
> 닿으면, 아래 "결정 로그"에 한 줄 추가하고 구현 상태를 갱신한다.

## 스코프

이 frontend 는 검증용 *놀이터*다. 실서비스용 백엔드/스토리지가 아니다.

- 한 사용자 · 한 워크스페이스 · 파일 한 개(`data/flow.json`) 영속성
- 캔버스에서 노드(Dynamic/CRUD/Derived/Interceptor) 를 만들고 엣지로 잇고,
  ▶ Run Flow 로 실제 데이터를 흘려본다.
- 노드 클릭 시 중앙 모달이 떠 설정을 편집한다 (사이드 패널 X).

목적은 모델이 "실제 입력으로 결과를 만들어내는가" 를 눈으로 확인하는 것.
운영성(권한·동시성·캐싱 등) 은 후순위.

## 모델 매핑

doc 의 [V-0008](https://github.com/paikku/table-block-doc/blob/main/docs/verifications.md#v-0008-derived-테이블의-행-생성을-셀-룰과-분리해-first-class로-표현할-수-있는가)
이후 Derived 시그니처는 다음과 같다.

```
Derive(rowGen, cellRules, deps[])

rowGen   = KeysFrom | Filter | Union | Product | Generate
cellRule = pick | formula | cases
```

| 영역 | doc 모델 | frontend 구현 | 비고 |
|---|---|---|---|
| Node = Table \| Interceptor | V-0007 | ✅ `kind: dynamic\|crud\|derived\|interceptor` | |
| Dynamic = Fetch(f, params) | V-0004 | ✅ `fetchUrl + params(JSON dict)` | params 의 *셀 참조* 일급화는 후순위 — 현재는 자유 텍스트 dict |
| CRUD = State(S, ops, opts) | V-0002·V-0004·V-0005 | 🟡 `schema + rowsJson + history/audit` | `ops` 스트림 / `commits` 사이드 테이블 미구현 |
| Derive: rowGen 분리 | V-0008 | 🟡 부분 — KeysFrom · Union · Filter | Product / Generate 미구현 |
| Derive: cellRules 통합 | V-0008 · V-0001 | ✅ pick / formula / cases (first-match-wins) | |
| Interceptor (pass/block/filter) | V-0007 | ✅ guard · effect · mode 3종 | effect 는 설명 문자열 (실제 외부 액션은 호출 X) |
| DAG / topo / cycle 거부 | dag.md | ✅ runFlow 가 topo sort, cycle 시 거부 | |
| 변경 추적 (ops · commits · defs) | V-0005·V-0006 | ❌ | 도입 시점이 RAG 커버리지 경계라 모델 정확성 우선 |

## 결정 로그

`YYYY-MM-DD` 순서, append-only. 모델 변경 시 추가.

### D-0001 (2026-05-18): Derived 를 `rowGen × cellRules` 로 재구조화

- **계기**: doc V-0008 이 행 생성을 셀 룰에서 분리해 first-class 로 끌어올림.
  구버전 frontend 의 `primaryNodeId + inputJoins + pickColumns + computeColumns`
  는 `KeysFrom(primary, [k])` 한 케이스만 표현 가능.
- **결정**:
  - `DerivedConfig.rowGen: RowGenSpec` 추가
  - `pickColumns + computeColumns` → 단일 `cellRules: CellRule[]` 로 통합 (mode: `pick` | `formula` | `cases`)
  - `primaryNodeId` / `inputJoins` 제거 — 단일 키 가정으로 흡수
- **스코프**: MVP 에서 rowGen 3종 — `KeysFrom` · `Union` · `Filter`
- **단순화 가정 (MVP)**:
  - 키는 *단일 컬럼*. 모든 incoming 들이 같은 컬럼명을 공유하면 lookup 됨.
  - Union 은 두 KeysFrom 의 합집합 (UI 는 2슬롯만). 더 깊은 중첩은 미지원.
  - Filter 는 KeysFrom 한 단계 위의 predicate. 더 깊은 중첩은 미지원.
- **legacy 자동 변환**: `normalizeNodeConfig` 가 구버전 저장본을 신모델로 변환.
  구버전 inputJoins 의 첫 key 또는 `'id'` 를 단일 키로 채택.

### D-0002 (2026-05-18): pickColumns 를 cellRules 의 한 mode 로 흡수

- **계기**: doc rule-evaluation.md 의 "컬럼 선언 방식" 분류 (pick · compute · mix)
  는 모두 *셀 층* 의 분기. 별도 필드로 둘 이유 없음.
- **결정**: `CellRule = CellPick | CellFormula | CellCases` 단일 리스트.
  "한 entry = 한 출력 컬럼" 원칙(b423b13) 유지.
- **결과**: ConfigModal 의 Derived 섹션이 두 섹션(rowGen / cellRules) 으로
  단순화. add 버튼은 mode 별(+pick / +formula / +cases) + "pick all from X" 단축.

### D-0003 (2026-05-18): 설정 UI 를 사이드 패널에서 *중앙 모달* 로 전환

- **계기**: 사이드 패널은 좁아서 Derived 의 두 층(rowGen + cellRules)을
  편집하기 힘들고, 캔버스 가용 영역을 늘 깎는다.
- **결정**: 노드 클릭 시 `ConfigModal` 이 backdrop + 중앙 카드 형태로 뜸.
  Esc / backdrop 클릭 / ✕ 버튼으로 닫음.
- **트레이드오프**: 모달은 한 번에 한 노드만 본다 (사이드 패널처럼 캔버스와
  동시 보기 X). 대신 가로 폭이 충분해 Derived 두 층 편집이 자연스럽다.

## 미구현 / 후순위 — 도입 시점 기준

명시적 후순위. doc 측 추가 검증이 나오기 전까지 빈 자리로 둔다.

- **rowGen `Product`** — cross product / join. 두 KeysFrom 의 곱집합.
  V-0008 의 R4 류 (`Generate`) 보다는 우선순위 위.
- **rowGen `Generate`** — 입력 0개 (range / calendar / recursion).
  spec 표현 형식이 doc 의 open-question.
- **단일 키 → 복합 키** — `keys: [k1, k2, ...]` 로 일반화.
  lookup 도 다중 키 매칭으로 확장.
- **Dynamic params 셀 참조 일급화** (V-0004 §2) — 현재 `Record<string,string>`
  자유 텍스트. `{node, column, key?}` 셀렉터로 바꾸면 DAG edge 자동 생성.
- **ops · commits 변경 추적** (V-0005 · V-0006) — 도입 시점이 *RAG 가
  과거를 답할 수 있는 경계*. 정확히 박을 때 박는다. 모델 정확성이 먼저.
- **schema 타입 추론** — Derived 출력 schema 의 type 을 `cellRules` 의
  실제 표현식에서 추론. 현재는 모두 `string` 으로 표시.
- **rowGen 중첩 UI** — `Filter(Union(...))` 같은 트리 편집. MVP 에서는
  최상위 type 만 노출.

## 코드 진입점

- `lib/types.ts` — 코어 타입 + legacy normalize
- `lib/runFlow.ts` — `runFlow(doc) → {tables, logs}`. rowGen 평가는 `evalRowGen`
- `lib/defaults.ts` — `SAMPLE_FLOW` (신모델 예시)
- `components/ConfigModal.tsx` — 중앙 모달 설정 UI
- `components/FlowEditor.tsx` — 캔버스 + 헤더 + 로그/테이블 뷰
- `app/api/flow/route.ts`, `app/api/run/route.ts` — load/save, run
- `data/flow.json` — 영속 (.gitignored 권장)
