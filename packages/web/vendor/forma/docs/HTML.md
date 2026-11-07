# Forma HTML patterns

These are structural examples, not a standalone JavaScript component library. Implement the listed behaviors in the host framework. Replace sample IDs with unique IDs, labels with product text, and placeholder destinations with real routes. No catalog script is included or required. For a complete executable form and native dialog, use the bundled HTML example.

## Button

次の行動を、明確に。 / Make the next action clear.

- Use: 保存・実行にはbutton、別の場所への移動にはaを使う。 / Use button for actions and a for navigation.
- Avoid: アイコンだけの操作には名前を付け、主操作は文言で示す。 / Name icon-only actions and give primary actions visible text.
- Why: 意味とキーボード操作を標準HTMLに任せられる。 / Native HTML preserves semantics and keyboard behavior.
- Structure: button · type · disabled · aria-busy

```html
<div class="demo-row">
<button type="button" class="f-button f-button--primary" >変更を保存</button>
<button type="button" class="f-button f-button--secondary" >キャンセル</button>
<button type="button" class="f-button f-button--ghost" >詳細を見る ↗</button>
<button type="button" class="f-button f-button--secondary"  disabled>操作できません</button>
<button type="button" class="f-button f-button--primary"  disabled aria-busy="true">保存中</button>
<button type="button" class="f-button f-button--danger" >削除</button>
</div>
```

## IconButton

限られたスペースに、明確な操作を。 / Compact actions with clear meaning.

- Use: 保存・実行にはbutton、別の場所への移動にはaを使う。 / Use button for actions and a for navigation.
- Avoid: アイコンだけの操作には名前を付け、主操作は文言で示す。 / Name icon-only actions and give primary actions visible text.
- Why: 意味とキーボード操作を標準HTMLに任せられる。 / Native HTML preserves semantics and keyboard behavior.
- Structure: button · aria-label

```html
<div class="demo-row">
<button type="button" class="f-button f-button--primary" aria-label="追加">＋</button>
<button type="button" class="f-button f-button--secondary" aria-label="閉じる">×</button>
</div>
```

## Link

情報のつながりを示す。 / Connect related information.

- Use: 保存・実行にはbutton、別の場所への移動にはaを使う。 / Use button for actions and a for navigation.
- Avoid: アイコンだけの操作には名前を付け、主操作は文言で示す。 / Name icon-only actions and give primary actions visible text.
- Why: 意味とキーボード操作を標準HTMLに任せられる。 / Native HTML preserves semantics and keyboard behavior.
- Structure: a · href

```html
<a class="f-link" href="#">デザイン基礎を読む ↗</a>
```

## Badge

状態を、ひと目で伝える。 / Communicate status at a glance.

- Use: 状態・人物・区切り・独立した内容を、それぞれの意味に合わせて使う。 / Use status, identity, separators, and containers for their distinct purposes.
- Avoid: 全ての情報をカードで囲わない。色や画像だけで識別させない。 / Avoid boxing every item into a card or relying on color and imagery alone.
- Why: 装飾を増やさず、まとまりと重要度を読み取れる。 / Grouping and importance stay legible with less decoration.
- Structure: span · text

```html
<div class="demo-row">
<span class="f-badge f-tone-neutral">下書き</span>
<span class="f-badge f-tone-info">進行中</span>
<span class="f-badge f-tone-success">完了</span>
<span class="f-badge f-tone-warning">確認待ち</span>
<span class="f-badge f-tone-danger">要対応</span>
</div>
```

## Avatar

人とチームを識別する。 / Identify people and teams.

- Use: 状態・人物・区切り・独立した内容を、それぞれの意味に合わせて使う。 / Use status, identity, separators, and containers for their distinct purposes.
- Avoid: 全ての情報をカードで囲わない。色や画像だけで識別させない。 / Avoid boxing every item into a card or relying on color and imagery alone.
- Why: 装飾を増やさず、まとまりと重要度を読み取れる。 / Grouping and importance stay legible with less decoration.
- Structure: img · alt / role="img" · aria-label

```html
<div class="demo-row">
<span class="f-avatar" role="img" aria-label="Aoi Tanaka" style="width:48px;height:48px">AT</span>
<span class="f-avatar" role="img" aria-label="Ken Sato" style="width:32px;height:32px">KS</span>
</div>
```

## Divider

関連する情報の境界を整える。 / Separate related groups.

- Use: 状態・人物・区切り・独立した内容を、それぞれの意味に合わせて使う。 / Use status, identity, separators, and containers for their distinct purposes.
- Avoid: 全ての情報をカードで囲わない。色や画像だけで識別させない。 / Avoid boxing every item into a card or relying on color and imagery alone.
- Why: 装飾を増やさず、まとまりと重要度を読み取れる。 / Grouping and importance stay legible with less decoration.
- Structure: hr

```html
<div class="demo-wide">基本情報<hr class="f-divider">詳細情報</div>
```

## Card

独立した内容をまとめる。 / Group a self-contained piece of content.

- Use: 状態・人物・区切り・独立した内容を、それぞれの意味に合わせて使う。 / Use status, identity, separators, and containers for their distinct purposes.
- Avoid: 全ての情報をカードで囲わない。色や画像だけで識別させない。 / Avoid boxing every item into a card or relying on color and imagery alone.
- Why: 装飾を増やさず、まとまりと重要度を読み取れる。 / Grouping and importance stay legible with less decoration.
- Structure: section · heading

```html
<section class="f-card">
<div class="f-between">
<h3>チームプラン</h3>
<span class="f-badge f-tone-success">利用中</span>
</div>
<p>チームの仕事を、ひとつの場所に。</p>
<a class="f-link" href="#">プランの詳細 →</a>
</section>
```

## TextField

迷わず入力できる基本形。 / A dependable text input.

- Use: ラベル・例・必要な補助文を入力前から提示する。 / Show a label, example, and relevant help before entry.
- Avoid: プレースホルダーだけをラベルにしない。検索と確定操作を混同しない。 / Do not use placeholders as the only labels or confuse searching with submitting.
- Why: 入力後も目的と修正方法を確認できる。 / The purpose and correction path remain available after typing.
- Structure: label · input · required · aria-describedby

```html
<form id="text-demo" class="stack demo-field" novalidate>
<div class="f-field">
<label for="company">会社名</label>
<input class="f-input" id="company" type="text" required aria-describedby="company-help company-error" placeholder="株式会社 フォルマ">
</div>
<small id="company-help" class="f-help">請求書に記載される正式名称</small>
<span id="company-error" class="f-error" role="alert">
</span>
<button class="f-button" type="submit">入力を確認</button>
<div class="f-field">
<label for="reference">管理番号</label>
<input class="f-input" id="reference" type="text" value="FRM-2026-001" disabled>
</div>
</form>
```

## TextArea

説明や備考を、十分な広さで。 / Room for details and context.

- Use: ラベル・例・必要な補助文を入力前から提示する。 / Show a label, example, and relevant help before entry.
- Avoid: プレースホルダーだけをラベルにしない。検索と確定操作を混同しない。 / Do not use placeholders as the only labels or confuse searching with submitting.
- Why: 入力後も目的と修正方法を確認できる。 / The purpose and correction path remain available after typing.
- Structure: label · textarea · rows

```html
<div class="f-field">
<label for="notes">備考</label>
<textarea id="notes" class="f-input f-textarea" rows="4" placeholder="補足情報を入力">
</textarea>
</div>
```

## NumberField

数値を安全に調整する。 / Adjust numeric values precisely.

- Use: 正確な値はNumberField、感覚的な調整はSlider。 / Use NumberField for exact values and Slider for approximate adjustment.
- Avoid: 単位と上下限を省かない。小さなスライダーで厳密な値を要求しない。 / Include units and bounds. Do not require precision from a short slider.
- Why: 入力方法と作業の要求が一致する。 / The input method matches the task.
- Structure: input[type=number] · min · max · step

```html
<div class="f-field">
<label for="number">メンバー数</label>
<input class="f-input" id="number" type="number" min="1" max="100" step="1" value="5">
</div>
```

## SearchField

探す行動をすぐに始める。 / Find what matters quickly.

- Use: ラベル・例・必要な補助文を入力前から提示する。 / Show a label, example, and relevant help before entry.
- Avoid: プレースホルダーだけをラベルにしない。検索と確定操作を混同しない。 / Do not use placeholders as the only labels or confuse searching with submitting.
- Why: 入力後も目的と修正方法を確認できる。 / The purpose and correction path remain available after typing.
- Structure: input[type=search]

```html
<div class="stack">
<div class="f-field">
<label for="search-demo">案件を検索</label>
<input class="f-input" id="search-demo" type="search" >
</div>
<small class="f-help" id="search-status" role="status">入力すると検索条件が更新されます</small>
</div>
```

## Checkbox

複数の選択肢を独立して選ぶ。 / Choose independent options.

- Use: 複数選択はCheckbox、排他的な選択はRadioGroup、即時の設定変更はSwitch。 / Use Checkbox for independent choices, RadioGroup for one-of-many, and Switch for immediate settings.
- Avoid: 保存が必要なフォームで即時反映に見えるSwitchを使わない。 / Avoid an immediate-looking switch for settings that require a separate save.
- Why: 選択した後に何が起こるか予測しやすい。 / People can predict what happens after a change.
- Structure: input[type=checkbox] · checked

```html
<div class="stack">
<label class="f-check">
<input type="checkbox" checked>
<span>メールで通知を受け取る</span>
</label>
<label class="f-check">
<input type="checkbox" disabled>
<span>管理者による設定</span>
</label>
</div>
```

## RadioGroup

候補から1つを選ぶ。 / Choose one option from a set.

- Use: 複数選択はCheckbox、排他的な選択はRadioGroup、即時の設定変更はSwitch。 / Use Checkbox for independent choices, RadioGroup for one-of-many, and Switch for immediate settings.
- Avoid: 保存が必要なフォームで即時反映に見えるSwitchを使わない。 / Avoid an immediate-looking switch for settings that require a separate save.
- Why: 選択した後に何が起こるか予測しやすい。 / People can predict what happens after a change.
- Structure: fieldset · legend · input[type=radio]

```html
<fieldset class="f-field f-fieldset">
<legend>請求サイクル</legend>
<div class="f-options">
<label class="f-radio">
<input type="radio" name="billing" value="monthly" checked>月次</label>
<label class="f-radio">
<input type="radio" name="billing" value="yearly">年次</label>
</div>
</fieldset>
```

## Switch

設定をその場で切り替える。 / Toggle an immediate setting.

- Use: 複数選択はCheckbox、排他的な選択はRadioGroup、即時の設定変更はSwitch。 / Use Checkbox for independent choices, RadioGroup for one-of-many, and Switch for immediate settings.
- Avoid: 保存が必要なフォームで即時反映に見えるSwitchを使わない。 / Avoid an immediate-looking switch for settings that require a separate save.
- Why: 選択した後に何が起こるか予測しやすい。 / People can predict what happens after a change.
- Structure: input[type=checkbox][role=switch]

```html
<label class="f-switch">
<input type="checkbox" role="switch" checked>
<span class="f-switch-track" aria-hidden="true">
<span>
</span>
</span>自動保存</label>
```

## Select

まとまった候補から選ぶ。 / Select from a known set.

- Use: 固定候補にはSelect、自由入力への候補提示にはdatalistのComboBox例。 / Use Select for a closed set and the datalist example for free-text suggestions.
- Avoid: datalistの候補以外を入力できないと思わせない。 / Do not imply that datalist prevents values outside its suggestions.
- Why: 入力可能な値と見た目の期待を揃えられる。 / The interface communicates what values are accepted.
- Structure: select · option

```html
<div class="f-field">
<label for="department">担当部署</label>
<select class="f-input f-select-button" id="department">
<option>デザイン</option>
<option>開発</option>
<option>事業推進</option>
<option>サポート</option>
</select>
</div>
```

## ComboBox

候補を絞り込みながら選ぶ。 / Search and select an option.

- Use: 固定候補にはSelect、自由入力への候補提示にはdatalistのComboBox例。 / Use Select for a closed set and the datalist example for free-text suggestions.
- Avoid: datalistの候補以外を入力できないと思わせない。 / Do not imply that datalist prevents values outside its suggestions.
- Why: 入力可能な値と見た目の期待を揃えられる。 / The interface communicates what values are accepted.
- Structure: input[list] · datalist

Native datalist permits free input. Use Select for a fixed list.

```html
<div class="f-field">
<label for="team-search">部署を検索</label>
<input class="f-input" id="team-search" list="team-options" autocomplete="off" aria-describedby="team-help">
<datalist id="team-options">
<option value="デザイン">
</option>
<option value="開発">
</option>
<option value="事業推進">
</option>
<option value="サポート">
</option>
</datalist>
<small id="team-help" class="f-help">候補を選択するか、部署名を入力します。</small>
</div>
```

## DatePicker

日付を入力・選択する。 / Enter or pick a calendar date.

- Use: 日付の上下限やファイル形式・容量を、選ぶ前に表示する。 / Explain date bounds or file types and size before selection.
- Avoid: ブラウザの入力補助だけに保存時の検証を任せない。 / Do not rely on browser assistance as the sole validation at save time.
- Why: 選び直しを減らし、エラーから回復しやすくする。 / Clear constraints reduce retries and support recovery.
- Structure: input[type=date]

Native date values are YYYY-MM-DD; display follows browser/OS. Validate ranges explicitly.

```html
<div class="f-field">
<label for="due-date">納期</label>
<input class="f-input" id="due-date" type="date" value="2026-11-20" min="2026-01-01">
</div>
```

## DateRangePicker

開始日と終了日を選ぶ。 / Select a start and end date.

- Use: 日付の上下限やファイル形式・容量を、選ぶ前に表示する。 / Explain date bounds or file types and size before selection.
- Avoid: ブラウザの入力補助だけに保存時の検証を任せない。 / Do not rely on browser assistance as the sole validation at save time.
- Why: 選び直しを減らし、エラーから回復しやすくする。 / Clear constraints reduce retries and support recovery.
- Structure: fieldset · input[type=date] · min · max

Native date values are YYYY-MM-DD; display follows browser/OS. Validate ranges explicitly.

```html
<fieldset class="f-field f-fieldset">
<legend>集計期間</legend>
<div class="native-date-range">
<div class="f-field">
<label for="start-date">開始日</label>
<input class="f-input" id="start-date" type="date" value="2026-11-01" aria-describedby="range-error">
</div>
<div class="f-field">
<label for="end-date">終了日</label>
<input class="f-input" id="end-date" type="date" value="2026-11-30" aria-describedby="range-error">
</div>
</div>
<span id="range-error" class="f-error" role="alert">
</span>
</fieldset>
```

## Slider

連続値を直感的に調整する。 / Adjust a value along a range.

- Use: 正確な値はNumberField、感覚的な調整はSlider。 / Use NumberField for exact values and Slider for approximate adjustment.
- Avoid: 単位と上下限を省かない。小さなスライダーで厳密な値を要求しない。 / Include units and bounds. Do not require precision from a short slider.
- Why: 入力方法と作業の要求が一致する。 / The input method matches the task.
- Structure: input[type=range] · output

```html
<div class="f-field">
<label for="zoom">表示倍率</label>
<input id="zoom" type="range" min="0" max="100" value="60">
<output for="zoom" id="zoom-output">60</output>
</div>
```

## FileUpload

ファイルを選び、内容を確認する。 / Select and review local files.

- Use: 日付の上下限やファイル形式・容量を、選ぶ前に表示する。 / Explain date bounds or file types and size before selection.
- Avoid: ブラウザの入力補助だけに保存時の検証を任せない。 / Do not rely on browser assistance as the sole validation at save time.
- Why: 選び直しを減らし、エラーから回復しやすくする。 / Clear constraints reduce retries and support recovery.
- Structure: input[type=file] · accept

```html
<div class="f-field">
<label for="file-demo">資料（PDF、5 MiBまで）</label>
<div class="f-upload">
<input type="file" id="file-demo" accept=".pdf" aria-describedby="file-error">
</div>
<span class="f-error" id="file-error" role="alert">
</span>
<ul id="file-list" class="f-file-list">
</ul>
</div>
```

## Tabs

関連する情報を切り替える。 / Switch between related views.

- Use: 選択中のタブ、階層、現在ページをそれぞれ明示する。 / Show the active view, hierarchy, and page position explicitly.
- Avoid: タブを必須の手順として使わない。ページ送りで選択状態を黙って消さない。 / Do not use tabs as required steps or silently clear selection during pagination.
- Why: 情報を切り替えても作業の位置を把握できる。 / People retain orientation while switching information.
- Structure: tablist · tab · tabpanel · aria-selected

```html
<div class="f-tabs">
<div class="f-tab-list" role="tablist" aria-label="案件情報">
<button type="button" class="f-tab" id="tab-0" role="tab" aria-selected="true" aria-controls="panel-0" tabindex="0">概要</button>
<button type="button" class="f-tab" id="tab-1" role="tab" aria-selected="false" aria-controls="panel-1" tabindex="-1">活動履歴</button>
<button type="button" class="f-tab" id="tab-2" role="tab" aria-selected="false" aria-controls="panel-2" tabindex="-1">ファイル</button>
</div>
<div class="f-tab-panel" role="tabpanel" id="panel-0" aria-labelledby="tab-0" tabindex="0" >案件の概要と現在の状況を確認できます。</div>
<div class="f-tab-panel" role="tabpanel" id="panel-1" aria-labelledby="tab-1" tabindex="0" hidden>11月2日 — 案件が作成されました。</div>
<div class="f-tab-panel" role="tabpanel" id="panel-2" aria-labelledby="tab-2" tabindex="0" hidden>ファイルはまだありません。</div>
</div>
```

## Breadcrumbs

今いる場所を示す。 / Show the current location.

- Use: 選択中のタブ、階層、現在ページをそれぞれ明示する。 / Show the active view, hierarchy, and page position explicitly.
- Avoid: タブを必須の手順として使わない。ページ送りで選択状態を黙って消さない。 / Do not use tabs as required steps or silently clear selection during pagination.
- Why: 情報を切り替えても作業の位置を把握できる。 / People retain orientation while switching information.
- Structure: nav · ol · aria-current

```html
<nav aria-label="現在位置">
<ol class="f-breadcrumbs">
<li>
<a class="f-link" href="#">ホーム</a>
</li>
<li>
<a class="f-link" href="#">案件管理</a>
</li>
<li>
<span aria-current="page">案件詳細</span>
</li>
</ol>
</nav>
```

## Pagination

一覧を区切って読み進める。 / Move through a collection.

- Use: 選択中のタブ、階層、現在ページをそれぞれ明示する。 / Show the active view, hierarchy, and page position explicitly.
- Avoid: タブを必須の手順として使わない。ページ送りで選択状態を黙って消さない。 / Do not use tabs as required steps or silently clear selection during pagination.
- Why: 情報を切り替えても作業の位置を把握できる。 / People retain orientation while switching information.
- Structure: nav · button · disabled

```html
<nav class="f-pagination" aria-label="ページ">
<button type="button" class="f-button f-button--secondary" disabled>前へ</button>
<span id="demo-page" aria-live="polite">1 / 5</span>
<button type="button" class="f-button f-button--secondary" >次へ</button>
</nav>
```

## Menu

補助的な操作をまとめる。 / Group secondary actions.

- Use: 補助操作や追加説明を、関連する対象の近くで開示する。 / Reveal secondary actions and details near the relevant subject.
- Avoid: 必須情報や主操作を折り畳み・ツールチップの中に隠さない。 / Do not hide essential information or primary actions in collapsed content or tooltips.
- Why: 読み始めの負担を抑えつつ、必要な情報に到達できる。 / The initial view stays manageable while details remain reachable.
- Structure: popover · menu · menuitem

```html
<div>
<button type="button" class="f-button f-button--secondary"  popovertarget="demo-menu" aria-haspopup="menu">その他の操作</button>
<div id="demo-menu" class="f-popover native-popover" popover role="menu" aria-label="その他の操作">
<button role="menuitem" class="f-option">複製する</button>
<button role="menuitem" class="f-option">アーカイブする</button>
</div>
</div>
```

## Tooltip

短い補足を、必要なときに。 / Offer concise contextual hints.

- Use: 補助操作や追加説明を、関連する対象の近くで開示する。 / Reveal secondary actions and details near the relevant subject.
- Avoid: 必須情報や主操作を折り畳み・ツールチップの中に隠さない。 / Do not hide essential information or primary actions in collapsed content or tooltips.
- Why: 読み始めの負担を抑えつつ、必要な情報に到達できる。 / The initial view stays manageable while details remain reachable.
- Structure: aria-describedby · role=tooltip

```html
<span class="native-tooltip">
<button type="button" class="f-button f-button--secondary"  aria-label="表示設定" aria-describedby="tip">⚙</button>
<span role="tooltip" id="tip" class="f-tooltip">表示する項目を設定します</span>
</span>
```

## Popover

その場で補助情報を確認する。 / Show contextual supporting content.

- Use: 補助操作や追加説明を、関連する対象の近くで開示する。 / Reveal secondary actions and details near the relevant subject.
- Avoid: 必須情報や主操作を折り畳み・ツールチップの中に隠さない。 / Do not hide essential information or primary actions in collapsed content or tooltips.
- Why: 読み始めの負担を抑えつつ、必要な情報に到達できる。 / The initial view stays manageable while details remain reachable.
- Structure: popover · popovertarget

```html
<div>
<button type="button" class="f-button f-button--secondary"  popovertarget="demo-popover">表示設定</button>
<div id="demo-popover" class="f-popover f-popover-content native-popover" popover>
<div class="stack">
<label class="f-check">
<input type="checkbox" checked>
<span>担当者を表示</span>
</label>
<label class="f-check">
<input type="checkbox" checked>
<span>金額を表示</span>
</label>
</div>
</div>
</div>
```

## Dialog

集中して判断・操作する。 / Focus on a decision or task.

- Use: 短い判断にはDialog、一覧に関連した短い詳細・編集にはDrawer。 / Use Dialog for a short decision and Drawer for contextual detail or editing.
- Avoid: 長い入力は独立ページにする。モーダルを何段も重ねない。 / Use a dedicated page for long forms. Avoid stacked modals.
- Why: 起点と終点を明確にし、閉じた後に作業へ戻れる。 / A clear start and finish make returning to the task straightforward.
- Structure: dialog · showModal() · close()

```html
<button type="button" class="f-button f-button--secondary" >ダイアログを開く</button>
<dialog id="demo-dialog" class="f-dialog" aria-labelledby="dialog-title">
<header class="f-between">
<h2 id="dialog-title">案件詳細</h2>
<button type="button" class="f-button f-button--ghost" aria-label="閉じる">×</button>
</header>
<div class="f-dialog-content">
<p>一覧の文脈を保ちながら、内容を確認できます。</p>
<div class="f-field">
<label for="detail-name">案件名</label>
<input class="f-input" id="detail-name" type="text" value="サイト刷新">
</div>
</div>
</dialog>
```

## Drawer

文脈を保ったまま詳細を見る。 / View details alongside the current context.

- Use: 短い判断にはDialog、一覧に関連した短い詳細・編集にはDrawer。 / Use Dialog for a short decision and Drawer for contextual detail or editing.
- Avoid: 長い入力は独立ページにする。モーダルを何段も重ねない。 / Use a dedicated page for long forms. Avoid stacked modals.
- Why: 起点と終点を明確にし、閉じた後に作業へ戻れる。 / A clear start and finish make returning to the task straightforward.
- Structure: dialog · showModal() · close()

```html
<button type="button" class="f-button f-button--secondary" >詳細を開く</button>
<dialog id="demo-dialog" class="f-drawer" aria-labelledby="dialog-title">
<header class="f-between">
<h2 id="dialog-title">案件詳細</h2>
<button type="button" class="f-button f-button--ghost" aria-label="閉じる">×</button>
</header>
<div class="f-dialog-content">
<p>一覧の文脈を保ちながら、内容を確認できます。</p>
<div class="f-field">
<label for="detail-name">案件名</label>
<input class="f-input" id="detail-name" type="text" value="サイト刷新">
</div>
</div>
</dialog>
```

## Accordion

詳細を必要に応じて開く。 / Reveal details on demand.

- Use: 補助操作や追加説明を、関連する対象の近くで開示する。 / Reveal secondary actions and details near the relevant subject.
- Avoid: 必須情報や主操作を折り畳み・ツールチップの中に隠さない。 / Do not hide essential information or primary actions in collapsed content or tooltips.
- Why: 読み始めの負担を抑えつつ、必要な情報に到達できる。 / The initial view stays manageable while details remain reachable.
- Structure: details · summary

```html
<div class="f-accordion">
<details>
<summary>チームメンバーを追加するには？<span aria-hidden="true">+</span>
</summary>
<div>チーム設定から、メンバーの招待を選択してください。</div>
</details>
<details>
<summary>データをエクスポートできますか？<span aria-hidden="true">+</span>
</summary>
<div>これは画面例です。実サービスではCSVなどの形式を用意します。</div>
</details>
</div>
```

## Alert

重要な情報を画面内で伝える。 / Surface important inline feedback.

- Use: 修正が必要か、待てばよいか、追加すればよいかを言葉で示す。 / Explain whether to correct, wait, or add something.
- Avoid: エラーをToastだけで伝えない。未取得とデータなしを同じ表示にしない。 / Do not communicate errors only in a toast or confuse loading with an empty result.
- Why: 画面の状態を推測せずに作業を続けられる。 / People can continue without guessing what the system is doing.
- Structure: role=alert / role=status

```html
<div class="stack">
<div class="f-alert f-tone-success" role="status">
<strong>変更を保存しました</strong>
</div>
<div class="f-alert f-tone-danger" role="alert">
<strong>入力内容を確認してください</strong>
<div>必須項目が入力されていません。</div>
</div>
</div>
```

## Toast

操作の結果を簡潔に伝える。 / Confirm the result of an action.

- Use: 修正が必要か、待てばよいか、追加すればよいかを言葉で示す。 / Explain whether to correct, wait, or add something.
- Avoid: エラーをToastだけで伝えない。未取得とデータなしを同じ表示にしない。 / Do not communicate errors only in a toast or confuse loading with an empty result.
- Why: 画面の状態を推測せずに作業を続けられる。 / People can continue without guessing what the system is doing.
- Structure: role=status · close button

```html
<button type="button" class="f-button f-button--secondary" >通知を表示</button>
```

## Progress

処理の進み具合を示す。 / Show progress toward completion.

- Use: 修正が必要か、待てばよいか、追加すればよいかを言葉で示す。 / Explain whether to correct, wait, or add something.
- Avoid: エラーをToastだけで伝えない。未取得とデータなしを同じ表示にしない。 / Do not communicate errors only in a toast or confuse loading with an empty result.
- Why: 画面の状態を推測せずに作業を続けられる。 / People can continue without guessing what the system is doing.
- Structure: progress · value · max

```html
<div class="f-field">
<label for="progress">データを準備中</label>
<progress id="progress" max="100" value="65">65%</progress>
</div>
```

## Skeleton

読み込み中の領域を保つ。 / Reserve space while content loads.

- Use: 修正が必要か、待てばよいか、追加すればよいかを言葉で示す。 / Explain whether to correct, wait, or add something.
- Avoid: エラーをToastだけで伝えない。未取得とデータなしを同じ表示にしない。 / Do not communicate errors only in a toast or confuse loading with an empty result.
- Why: 画面の状態を推測せずに作業を続けられる。 / People can continue without guessing what the system is doing.
- Structure: aria-hidden · role=status

```html
<div class="stack" role="status">
<span class="f-sr-only">読み込み中</span>
<span class="f-skeleton" aria-hidden="true" style="height:20px;width:40%">
</span>
<span class="f-skeleton" aria-hidden="true" style="height:16px">
</span>
<span class="f-skeleton" aria-hidden="true" style="height:16px;width:80%">
</span>
</div>
```

## EmptyState

情報がない理由と次の行動を示す。 / Explain an empty view and the next step.

- Use: 修正が必要か、待てばよいか、追加すればよいかを言葉で示す。 / Explain whether to correct, wait, or add something.
- Avoid: エラーをToastだけで伝えない。未取得とデータなしを同じ表示にしない。 / Do not communicate errors only in a toast or confuse loading with an empty result.
- Why: 画面の状態を推測せずに作業を続けられる。 / People can continue without guessing what the system is doing.
- Structure: heading · explanatory text · action

```html
<div class="f-empty">
<span class="f-empty-icon" aria-hidden="true">≡</span>
<strong>まだ案件がありません</strong>
<p>最初の案件を追加して、チームの進捗を管理しましょう。</p>
<button type="button" class="f-button f-button--primary" >案件を追加</button>
</div>
```

## DataTable

情報を比較し、必要な操作へ。 / Compare records and take action.

- Use: 名称は左、数値は右に揃え、同じ列で単位と日付表記を統一する。 / Align names left and numbers right; keep units and date formats consistent within a column.
- Avoid: 狭い画面で重要な列を無言で消さない。アイコンだけの状態を並べない。 / Do not silently remove important columns on narrow screens or use icon-only statuses.
- Why: 値の差を目で追え、誤読と横断的な確認の手間を減らせる。 / Aligned values reduce misreading and the effort of comparing rows.
- Structure: table · caption · th[scope] · aria-sort

```html
<div class="f-table-scroll">
<table class="native-example-table">
<caption>案件一覧</caption>
<thead>
<tr>
<th scope="col">案件名</th>
<th scope="col">状態</th>
</tr>
</thead>
<tbody>
<tr>
<td>サイト刷新</td>
<td>
<span class="f-badge f-tone-info">進行中</span>
</td>
</tr>
</tbody>
</table>
</div>
```
