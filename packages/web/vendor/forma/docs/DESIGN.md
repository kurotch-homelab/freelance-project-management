# Bundled Forma design reference

This is a complete local design reference. Catalog mentions describe the original examples; the catalog and source repository are not prerequisites. Use the bundled HTML.md and React examples instead.

# Forma — Design guidelines

Formaはビジネス向けのデザインガイドラインです。フレームワーク、コンポーネントAPI、状態管理の採用を要求しません。色・文字・余白・情報階層・操作時の振る舞いを共有し、製品ごとの実装はそれぞれの技術で行います。

Reactを利用する製品では、任意の準拠実装`@kurotch-homelab/forma-react`を選べます。ガイドライン・トークン・スタイルは引き続きフレームワーク非依存です。React版のAPI・導入・責任範囲は同梱のREACT.mdに記載しています。

## 1. デザイン原則

- **明快な階層**：画面の目的、主要な情報、主操作を読み順に並べる。見出し・余白・整列を先に使い、境界線やカードは必要な区切りに限定する。
- **一貫した操作**：同じ意味の操作には同じ文言と外観を使う。主操作は1つを基本とし、破壊的操作と通常操作を区別する。
- **静かな存在感**：白・グレー・墨色を中心とし、青は操作と選択の目印に使う。装飾的グラデーション、強い影、意味のないアイコン、過度な丸角を避ける。
- **仕事の流れを優先**：業務画面では比較と入力のしやすさ、紹介ページでは読み進めやすさを優先する。情報量を減らすためだけに操作を隠さない。

## 2. Foundations

### 色

トークンは基本色 → 意味別 → 部品別の3層。利用側は`text`、`surface`、`brand`などの意味を選び、生の色値を画面中に散在させない。

| 役割       | CSS変数                                      | 用途                   |
| ---------- | -------------------------------------------- | ---------------------- |
| 全体の背景 | `--f-canvas`                                 | ページ全体             |
| 内容の面   | `--f-surface`                                | 入力・表・独立した情報 |
| 控えめな面 | `--f-subtle`                                 | 補助領域               |
| 本文       | `--f-text`                                   | 主要な文字             |
| 補助文     | `--f-muted`                                  | 説明・メタ情報         |
| 操作色     | `--f-brand` / `--f-on-brand`                 | 主操作・選択           |
| 境界       | `--f-border`                                 | 区切り・入力欄         |
| 状態       | `--f-success` / `--f-warning` / `--f-danger` | 完了・注意・エラー     |
| フォーカス | `--f-focus`                                  | キーボードの現在位置   |

ライトとダークは別の意味別トークンセットを持つ。ダークを単純な色反転で作らない。状態には必ず文字や形を添え、色だけで伝えない。配色変更時は通常の文字で4.5:1以上、大きな文字と識別が必要なUIの境界・状態で3:1以上を目安に検証する。

### 文字

標準書体は**IBM Plex Sans JP**。日本語と英数字を同じファミリーで揃え、Google Fontsから400・500・600を読み込む。本文は400、操作ラベルは500、見出し・強調は600を基本とする。550・650などの中間値は指定しない。読み込み中や通信できない場合は游ゴシック・ヒラギノ・メイリオなどのシステム書体へフォールバックする。

通常の字間は`0em`とし、書体本来の間隔とカーニングを活かす。日本語の見出し・金額・ロゴに負の字間を一律適用しない。短い英文の上部ラベルだけ`0.08em`を使う。太さは`--f-weight-regular` / `--f-weight-medium` / `--f-weight-semibold`、字間は`--f-tracking-normal` / `--f-tracking-overline`としてCSSとJSONで共有する。

カタログはGoogle Fontsの`display=swap`を使う。配布CSSには外部CSSの自動読み込みやフォントファイルを含めないため、このスキルでは同梱のfonts.cssと書体をセルフホストする。フレームワークやJavaScriptライブラリは追加しない。[IBM Plex Sans JP](https://fonts.google.com/specimen/IBM+Plex+Sans+JP)・[Google Fontsの読み込み仕様](https://developers.google.com/fonts/docs/css2)

| 用途           | 基準 |
| -------------- | ---- |
| Display        | 40px |
| 見出し         | 28px |
| セクション     | 20px |
| 紹介ページ本文 | 16px |
| 業務画面本文   | 14px |
| 補助文         | 12px |

本文の行高は1.6〜1.85。日本語の長文を過度に詰めない。金額や件数の比較には`font-variant-numeric: tabular-nums`を使う。表示上の大きさとHTMLの見出し階層を混同しない。

### 余白・形・動き

- 余白は4px単位。関連する情報は8〜16px、別のまとまりは24〜48pxを基準とする。
- 角丸は4 / 6 / 8px。丸形は人物画像や状態スイッチなど意味がある場合に限定する。
- 操作の高さは標準40px、密な業務画面32px。タッチ操作では周囲の余白も含めて十分な操作領域を確保する。
- 影はダイアログやポップアップなど浮いた面に限定する。
- 操作の反応は120ms、出入りは180ms、大きな開閉は240ms。`prefers-reduced-motion`に対応する。読み込み中は動きだけに頼らず状態を伝える。詳しくは「動きと遷移」を参照。

## 3. HTMLとアクセシビリティ

標準HTMLを優先する。ボタンに`button`、遷移に`a`、表に`table`、入力に`input` / `select`、開閉に`details` / `dialog`を使う。意味のある要素を使える場合に`div`とARIAで作り直さない。

| パターン                         | 守る構造・振る舞い                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Button / IconButton              | 動詞のラベル。アイコンだけの場合はアクセシブルな名前。無効・処理中を明示。                                                     |
| TextField / TextArea             | 永続的なラベル。補助文とエラーを`aria-describedby`で関連付ける。プレースホルダーはラベルの代わりにしない。                     |
| NumberField / Slider             | 単位と範囲を示す。正確な入力にはnumber、概量の調整にはrange。                                                                  |
| Checkbox / RadioGroup / Switch   | 独立した複数選択、排他的な単一選択、即時設定を区別する。標準入力のキー操作を保つ。                                             |
| Select / ComboBox                | 少数の固定候補にはselect。入力補助にはdatalist。datalistは自由入力を許すため、厳密な候補限定にはselectまたは追加検証を使う。   |
| DatePicker / DateRangePicker     | 日付のみの値は`YYYY-MM-DD`。表示・カレンダーUIはブラウザに委ねる。範囲の前後関係・必須・上下限は利用側でも検証する。           |
| FileUpload                       | 種類と上限を明記。選択済みファイルを確認・解除できること。HTMLのacceptだけを検証として扱わない。サーバー側の検証は別途必要。   |
| Tabs                             | tablist / tab / tabpanel、関連ID、選択状態とroving tabindex。左右矢印、Home / Endで移動。非表示パネルは操作対象から除く。      |
| Menu                             | menu / menuitemを使うなら矢印移動・Escape・起点へのフォーカス復帰も実装する。単なるリンク集にはmenuロールを付けない。          |
| Dialog / Drawer                  | 見出しと閉じる操作。`showModal()`で背景操作を抑制。Escapeで閉じ、起点へフォーカスを戻す。                                      |
| Popover / Tooltip                | 必須情報を隠さない。補助情報もキーボードで到達できること。TooltipはEscapeで解除できること。                                    |
| Alert / Toast                    | エラーには原因と対処法。必要な情報をライブ領域で伝える。通知だけに必須操作を依存させない。                                     |
| DataTable                        | caption、列見出し、比較可能な整列。ソート方向をaria-sortで示す。行選択に名前を付け、検索・空状態・ページ切り替えを明確にする。 |
| Skeleton / Progress / EmptyState | 読み込み、進捗、データなし、検索結果なしを区別。次の行動がある場合は明示する。                                                 |

CSSだけでは独自UIの操作・フォーカス制御・妥当性検証は保証されない。カタログのJavaScriptは操作例であり、配布CSSの依存ではない。製品では選択した技術に合わせて実装し、利用するブラウザと支援技術で検証する。

## 4. レスポンシブと文言

- 小画面ではナビゲーションを折り畳む。開閉とフォーカス位置を分かりやすくする。
- 横に長い表は表領域だけをスクロールさせ、ページ全体をはみ出させない。スクロール領域はキーボードでも操作可能にする。
- 日本語・英語で文字長が変わっても、意味のあるラベルを省略しない。固定幅の高さで文章を切らない。
- 日付入力などブラウザ標準UIの言語・フォント・配置はOSとブラウザに依存する。見た目を完全一致させるためだけに独自の操作部品を増やさない。
- 文言は具体的な動詞を使う。失敗時は「何が起きたか」「次にどうすればよいか」を短く伝える。

## 5. 技術との境界

1. **ガイドライン**：この文書とカタログ。コードを使わず、ルールだけを採用してもよい。
2. **トークン**：CSS変数・JSON。Web以外の環境では意味別トークンを各プラットフォームの形式に変換して使う。
3. **参考スタイル**：`forma.css`を1枚読み込む。npm、React、Web Components、JSランタイムは不要。
4. **カタログ**：標準HTML / CSS / JavaScriptで操作例を提供。カタログのコードを製品の必須ライブラリとして配布しない。

ダーク・ライトと密度は`data-theme="light|dark"`、`data-density="comfortable|compact"`で切り替える。OS設定への追従や保存は利用側の責任であり、CSSに状態管理を持ち込まない。

## 6. パターンを選ぶ

カタログの「パターンの選び方」では、目的を選ぶと推奨パターン・理由・別の選択が適する条件を表示する。画面の形より先に、ユーザーが完了したい作業を定める。

| 目的                           | 基本の選択               | 切り替える条件                                                                          |
| ------------------------------ | ------------------------ | --------------------------------------------------------------------------------------- |
| 一覧に関連した短い詳細・編集   | Drawer                   | 長いフォーム、複数段階、URLで共有する内容は独立ページ。モーダルDrawerの背景は操作不可。 |
| 取り消せない操作の判断         | Dialog                   | 通常の保存を毎回確認しない。復元可能ならUndoも検討。                                    |
| 同じ対象の情報を切り替える     | Tabs                     | 別の作業・場所はページ遷移。必須の手順にはタブを使わない。                              |
| 固定候補から1つだけ選ぶ        | Select                   | 少数の候補を比較させたい場合はRadioGroup。                                              |
| 候補を参考に自由に入力する     | ComboBox / datalist      | 候補に限定する場合はSelect。datalistは自由入力を許す。                                  |
| 設定を即時にオン・オフする     | Switch                   | 保存時にまとめて反映するフォームではCheckbox。                                          |
| 入力の修正を促す               | 入力欄に関連付けたエラー | 複数のエラーには要約も使う。Toastだけで伝えない。                                       |
| 保存完了を短く伝える           | Toast                    | 継続参照する注意・説明はAlert。必須の判断を通知に入れない。                             |
| 処理の進捗を伝える             | Progress                 | 既知の構造の読み込みはSkeleton、データなしはEmptyState。架空の進捗率を出さない。        |
| 同じ項目で複数の対象を比較する | DataTable                | 独立した説明文中心の内容はCard。                                                        |
| 操作の短い補足を示す           | Tooltip                  | 操作やリンクを含む補助領域はPopover。必須情報は常時表示。                               |
| 正確な数値を入力する           | NumberField              | 感覚的な強さ・概量の調整にはSlider。                                                    |

## 7. 操作状態の契約

状態は見た目と振る舞いをセットで定義する。カタログの「操作状態」では、ボタン・入力欄を切り替えて固定見本を比較できる。固定見本は操作対象ではなく、隣接する説明で意味を伝える。実際のホバー・フォーカス・処理中・選択は別の操作エリアで試す。

| 状態         | 視覚表現                               | 振る舞い                                                                      |
| ------------ | -------------------------------------- | ----------------------------------------------------------------------------- |
| 通常         | 役割に応じた面とラベル                 | 操作の結果を文言で予測できる。                                                |
| ホバー       | 背景・境界の変化                       | 意味やレイアウトを変えない。タッチ環境で必須情報をホバーに依存させない。      |
| フォーカス   | 2pxの外周リング、3pxの間隔             | キーボードの現在位置を表示。選択・エラー状態にも重ねて表示。                  |
| 押下         | ホバーより明確な背景変化               | 押している間だけ表示。継続する選択と混同しない。                              |
| 選択         | 色と境界、チェックなど                 | トグルはaria-pressed、タブはaria-selectedなど適切な属性を更新。               |
| 無効         | 低い強調                               | ホバー・押下に反応せず、実行しない。解除条件を無効要素の外に表示。            |
| 処理中       | 「保存中」などの文字、aria-busy        | 重複実行を防ぎ、結果を通知。aria-disabledを使う場合はJS側でも実行を抑止する。 |
| エラー       | エラー色の境界と具体的な修正メッセージ | aria-invalidとaria-describedbyを使う。色だけで伝えない。                      |
| 読み取り専用 | 控えめな面、読める文字                 | 値を変更させず、選択・コピー・読み取りを許可。disabledと区別。                |

**合成と優先順位**：無効はホバー・押下より優先する。処理中は新しい実行を抑止するが、フォーカスを不用意に失わせない。選択・エラーは持続する状態であり、フォーカスと併存する。通常のボタンに選択状態を残さない。

状態色は`--f-brand-hover`、`--f-brand-pressed`、`--f-surface-hover`、`--f-surface-pressed`で定義する。装飾的な区切りの`--f-border`と、操作領域を識別する`--f-control-border`を分ける。ライトとダークそれぞれで、主ボタンの文字4.5:1以上、入力境界と面3:1以上を確認する。数値・色はForma独自の選択で、MaterialやFluentの値の移植ではない。

## 8. 良い例・避ける例と理由

カタログには次の4組の静的な比較を掲載する。意図的な問題がある見本は「避ける例」と明示し、操作対象や製品用の推奨HTMLとして扱わない。

| 項目       | 良い例                                            | 避ける例                                               | 判断の理由                                                 |
| ---------- | ------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| 操作の階層 | 保存を主操作、キャンセルを補助、削除を分離        | 全てを同じ強い色で強調                                 | 視線の行き先が明確になり、誤操作を減らせる。               |
| 余白       | 項目内8px・同一グループ16px・グループ間32pxを基準 | 全てを同じ間隔で並べる                                 | 近接で関連性を表せば、区切り線を増やさず構造を理解できる。 |
| フォーム   | 消えないラベル、入力欄のそばに具体的な修正文      | プレースホルダーだけのラベル、「エラーです」だけの通知 | 入力後も目的と直し方が分かり、作業に復帰しやすい。         |
| 表         | 数値は右揃え・等幅数字、単位と桁区切りを統一      | 中央揃え、単位・表記を混在                             | 値の差を縦方向に追いやすく、比較の負担を減らせる。         |

35種のパターン詳細にも「使うとき」「避けること」「判断の理由」を掲載する。これらの判断は利用する製品の作業・データ量・端末に合わせて適用する。

## 9. 参考資料とFormaの採用判断

参照確認：2026年11月2日。以下は公式の設計ガイドへの参照であり、コード・フォント・UIパッケージの依存ではない。

- [Fluent 2 — Design principles](https://fluent2.microsoft.design/design-principles)：作業への集中、慣れた操作の尊重を、標準HTMLを優先する方針の参考にする。
- [Fluent 2 — Layout](https://fluent2.microsoft.design/layout)：近接・余白・整列が関係性を伝える考え方を、レイアウトの判断基準にする。
- [Fluent 2 — Typography](https://fluent2.microsoft.design/typography)：読み取りやすい階層とプラットフォームのフォントを参考に、日本語の行高・折り返しを調整する。
- [Fluent 2 — Accessibility](https://fluent2.microsoft.design/accessibility)：フォーカス、拡大表示、コントラストを、実装時の確認項目に含める。
- [Material Design 3 — Foundations](https://m3.material.io/foundations/)：トークン・操作状態・レイアウトを共通ルールとして体系化する構成を参考にする。

Formaの配色、角丸、密度、状態の数値、パターン選択基準は独自の設計判断。MicrosoftやGoogleの製品と同じ外観や動作、両デザインシステムへの適合・認証を表明するものではない。

## 10. 動きと遷移

動きは操作の結果と位置関係を伝えるために使う。カタログの「動きと遷移」では、実際のUIパターンと同じCSSで動作を確認できる。

| 用途                 | 時間             | 表現                                                                                   |
| -------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| ホバー・押下・Switch | 120ms            | 色・つまみの移動。ボタンの押下は1pxまで。無効な操作は動かさない。                      |
| ページ・Tabs         | 120ms            | 内容だけを短くフェード。ナビゲーションや画面全体を移動させない。                       |
| Popover・Menu        | 120ms            | 4pxの移動とフェード。操作元との関係を保つ。                                            |
| Dialog               | 入180ms・出120ms | 8pxの移動とフェード。背景も短く変化させる。                                            |
| Drawer               | 入240ms・出180ms | 右端からスライド。操作元へ戻る方向を示す。                                             |
| Accordion            | 180ms            | 内容に合わせた高さの変化。長文を固定の高さで切らない。                                 |
| Toast                | 入180ms・出120ms | 下から8px、終了は4pxの移動とフェード。読める時間を確保し、カタログでは自動消去しない。 |
| 既知の進捗           | 180ms            | 実際の値に合わせて幅を更新。架空の進捗率を進めない。                                   |
| Skeleton             | 1,400msを2回     | 控えめな透明度変化の後に静止。読み込み状態は文字でも伝える。                           |

時間は`--f-motion-fast` / `--f-motion-standard` / `--f-motion-deliberate`、速度の変化は`--f-ease-standard` / `--f-ease-enter` / `--f-ease-exit`で共有する。従来の`--f-motion-duration`は120msの互換トークンとして残す。値はForma独自の設計判断。バウンド、パララックス、無関係な常時ループ、表示を順番に待たせる演出は基本に含めない。

配布する`forma.css`に動きのCSSも同梱する。標準HTMLの`dialog`・`popover`・`details`の操作を維持し、`@starting-style`、離散的な表示切り替え、`::details-content`などは段階的な拡張として使う。対応しない環境では即時の開閉に戻る。`close()`直後にDOMを削除すると終了アニメーションは省略されるため、カタログの案件保存ではダイアログを残して一覧だけを更新する。Toastの削除処理はカタログ内の参考用JavaScriptであり、配布CSSには含めない。

**動きを減らす設定**：OSの`prefers-reduced-motion: reduce`を優先する。加えて`.forma`に`data-motion="reduce"`を指定できる。移動・フェード・脈動・スムーズスクロールを止めても、内容、状態、読み上げ通知、キーボード操作は維持する。カタログの設定はブラウザに保存し、OS設定の途中変更も反映する。

**操作とフォーカス**：状態は即時に更新する。終了アニメーションの完了を保存・閉じる・フォーカス復帰の条件にしない。閉じたオーバーレイや消える通知の操作要素をフォーカス対象から外す。連打、閉じてすぐ開く操作、新しい通知への置き換えでも状態を取り違えない。

参考：[Fluent 2 — Motion](https://fluent2.microsoft.design/motion)、[MDN — dialogのアニメーション](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog#animating_dialogs)、[MDN — details-content](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/::details-content)。

## English summary

Forma is a framework-independent design guideline, not a UI framework. Adopt its principles without using its code, share the CSS/JSON tokens, or use the standalone `forma.css` stylesheet. No UI framework, JavaScript library, npm installation, or provider component is required. The standard typeface is IBM Plex Sans JP at weights 400, 500, and 600. The catalog loads it from Google Fonts with `display=swap`; consumer projects load or host the font separately. System fonts remain as fallbacks. Use zero tracking for body text, headings, and numbers, and 0.08em for short overlines.

Preserve native HTML semantics. Prefer native inputs, select, datalist, details, dialog, and popover. Native date and suggestion interfaces vary by browser and OS. The catalog's JavaScript demonstrates interaction only; applications own validation, state, keyboard support, and focus management. Custom controls must meet the behavioral requirements described above. Test contrast, focus, keyboard behavior, screen readers, both themes, and longer translated content in the consuming product.

The bilingual catalog now includes a task-based pattern selector, nine defined interaction states with a live keyboard/pointer area, four recommended/avoid comparisons, and use/avoid/rationale guidance for all 35 patterns. Fluent 2 informs focus, hierarchy, proximity, and platform familiarity; Material Design informs the systematic organization of foundations. The linked sources are references, not dependencies. All numeric choices and color values remain Forma-specific.

The motion guide demonstrates 120ms feedback, 180ms transitions, and 240ms larger surfaces. Motion CSS is included in `forma.css` and progressively enhances native controls. OS reduced-motion settings and `data-motion="reduce"` remove movement without removing behavior. State updates and focus restoration are immediate; skeletons pulse only twice. No animation framework is required.
