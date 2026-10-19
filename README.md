# Local Lens

GitLens 대체용 사내 확장. **로컬 `git` CLI만 실행하며 네트워크·텔레메트리 코드가 없습니다** (`grep -n "http\|fetch\|net" *.js` 로 확인 가능). 의존성 0개.

## 기능
| 기능 | 사용법 |
|---|---|
| 현재 줄 blame (줄 끝 회색 텍스트) | 자동. `Local Lens: Toggle Current Line Blame` |
| Blame hover (전체 메시지, 변경 보기, 커밋 보기, SHA 복사) | 줄 끝 blame 텍스트에 마우스 |
| 상태바 blame | 자동, 클릭 시 커밋 파일 목록 |
| 파일 전체 blame (왼쪽 날짜·작성자·메시지) | `Alt+B` 또는 에디터 우측 상단 👤 |
| CodeLens (최근 변경자, 작성자 수) | 파일 첫 줄 위 |
| 파일 히스토리 (rename 추적) → diff | 에디터 우측 상단 🕘, 탐색기/에디터 우클릭 |
| 라인 히스토리 (`git log -L`) | 에디터 우클릭 → Show Line History |
| 커밋 검색 → 커밋의 변경 파일 → diff | `Local Lens: Search Commits` |
| HEAD와 비교 | `Local Lens: Open Changes with HEAD` |

저장 안 된 편집도 blame에 반영됩니다 (`git blame --contents -`). 신뢰하지 않는 워크스페이스에서는 비활성화됩니다.

## 빌드 / 설치
```sh
npm test          # 파서 self-test (임시 git 저장소 사용)
sh build.sh       # local-lens.vsix 생성 (vsce 불필요)
code --install-extension local-lens.vsix
```
