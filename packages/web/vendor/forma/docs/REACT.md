# Forma React API

Install the bundled package with the skill installer, then follow INTEGRATION.md. No build from the source repository or registry download of Forma is required. Import `@kurotch-homelab/forma-react/styles.css` once and serve the bundled fonts. The package includes ES Modules, declarations and component sources; React is its only runtime peer dependency.

## Providerと共通契約

| プロパティ                  | 値・既定値                                                         |
| --------------------------- | ------------------------------------------------------------------ |
| `locale`                    | `ja`（既定）/ `en`。組み込み文言・数値の比較・日付入力のlangに適用 |
| `theme`                     | `system`（既定）/ `light` / `dark`。OS変更を追従                   |
| `density`                   | `comfortable`（既定）/ `compact`                                   |
| `motion`                    | `system`（既定）/ `reduce`。OSのreduceは常に尊重                   |
| `className`, `style`, `ref` | Providerのルートdivに適用                                          |

`useForma()`から設定と` t(日本語, English)`を取得できます。入れ子のProviderは省略した設定を親から継承します。ProviderはlocalStorageを操作しません。プレビューでの保存はアプリ側の実装です。

`value` / `onValueChange`または`checked` / `onCheckedChange`が制御モード、`defaultValue` / `defaultChecked`が非制御モードです。状態の初期値と制御値を併用せず、途中でモードを切り替えないでください。通常の入力は`name`、`required`、`disabled`、`onChange`、`aria-*`とDOMの`ref`を受け取ります。`onChange`にはネイティブのReactイベント、`onValueChange`には値だけを渡します。Buttonの既定typeは`button`です。フォーム送信には`type="submit"`を指定します。

`label`を持つ入力は`useId`でlabel・説明・エラーを関連付けます。`error`はインライン表示・`aria-invalid`・読み上げ通知に反映します。アプリ固有の検証と保存はアプリ側で行ってください。業務文言や渡したchildrenは自動翻訳しません。

## 35部品の主要API

完全な型は`dist/index.d.ts`から参照できます。同梱のReact例と型定義を使い、利用アプリで操作を確認します。

| 部品            | 主なプロパティ                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| Button          | `variant: primary / secondary / ghost / danger`, `size: sm / md`, `loading`, `disabled`                          |
| IconButton      | Buttonの全プロパティ、必須の`label`、childrenにアイコン                                                          |
| Link            | 標準a属性、`href`, `ref`。ルーター固有の依存なし                                                                 |
| Badge           | `tone: neutral / info / success / warning / danger`                                                              |
| Avatar          | `name`, `src?`, `size`。画像失敗時は名前に戻る                                                                   |
| Divider         | 標準hr属性                                                                                                       |
| Card            | 標準div属性、`ref`                                                                                               |
| TextField       | `label`, `value/defaultValue`, `onValueChange`, `description`, `error`                                           |
| TextArea        | TextFieldと同じ値の契約、標準textarea属性                                                                        |
| NumberField     | `value: number \| null`, `onValueChange`, `min`, `max`, `step`。空はnull                                         |
| SearchField     | TextFieldと同じ契約、標準search入力                                                                              |
| Checkbox        | `label`, `checked/defaultChecked`, `onCheckedChange`, `indeterminate`                                            |
| RadioGroup      | `label`, `options`, `value/defaultValue`, `onValueChange`, `name`                                                |
| Switch          | Checkboxの契約（indeterminateを除く）、`role=switch`                                                             |
| Select          | `label`, `options`, `placeholder`, `value/defaultValue`, `onValueChange`                                         |
| ComboBox        | TextFieldの契約、`options`。標準datalist、自由入力を許容                                                         |
| DatePicker      | `label`, `value/defaultValue: YYYY-MM-DD`, `min`, `max`                                                          |
| DateRangePicker | `label`, `value/defaultValue: { start, end }`, `onValueChange`, `name`, `required`                               |
| Slider          | `label`, 数値の`value/defaultValue`, `onValueChange`, `min/max/step`                                             |
| FileUpload      | `label`, `value/defaultValue: File[]`, `onValueChange`, `accept`, `maxBytes`, `maxFiles`, `multiple`, `onReject` |
| Tabs            | `label`, `items: { id, label, content, disabled? }[]`, `value/defaultValue`, `onValueChange`                     |
| Breadcrumbs     | `items: { label, href? }[]`, `label`                                                                             |
| Pagination      | `total`, `pageSize`, `page/defaultPage`, `onPageChange`, `label`                                                 |
| Menu            | `label`, `items: { id, label, disabled?, onSelect? }[]`, `onAction`, `open/defaultOpen`, `onOpenChange`          |
| Tooltip         | `content`, childrenにフォーカス可能な要素を1個                                                                   |
| Popover         | `label`, `children`, `open/defaultOpen`, `onOpenChange`, `triggerProps`                                          |
| Dialog / Drawer | `title`, `description`, `trigger?`, `open/defaultOpen`, `onOpenChange`, `footer`, `onClose`, `ref`               |
| Accordion       | `items: { id, title, content }[]`, `value/defaultValue: string[]`, `onValueChange`, `multiple`                   |
| Alert           | `title`, `tone`, `children`, `role`（dangerはalert、それ以外はstatus）                                           |
| Toast           | `open/defaultOpen`, `onOpenChange`, `children`。自動で消えない                                                   |
| Progress        | `label`, `value?`, `max`, `showValue`。value省略で不定進捗                                                       |
| Skeleton        | `width`, `height`。装飾としてaria-hidden、親に読み込み状態を付ける                                               |
| EmptyState      | `title`, `description`, `icon`, `action`                                                                         |
| DataTable       | 次節参照                                                                                                         |

Select / RadioGroup / ComboBoxの`options`は`{ value: string, label: string, disabled?: boolean }[]`です。子のkeyとなるidやvalueには一意で安定した値を指定します。

## DataTable

```tsx
import { DataTable, type DataColumn } from '@kurotch-homelab/forma-react';
type Project = { id: string; name: string; budget: number; active: boolean };
const columns: DataColumn<Project>[] = [
  { key: 'name', header: '案件名', accessor: (row) => row.name },
  { key: 'budget', header: '予算', accessor: (row) => row.budget, align: 'right' },
];
// projectsは利用アプリで取得・保持するProject[]
<DataTable<Project>
  label="案件一覧"
  rows={projects}
  columns={columns}
  getRowId={(row) => row.id}
  getRowLabel={(row) => row.name}
  pageSize={10}
  selectable
  filter={(row) => row.active}
/>;
```

- `accessor`は検索・ソートに使うstring/number（null/undefined可）、`render`は表示用の任意ReactNodeです。`sortable={false}`相当は列の`sortable: false`で指定します。
- `query/defaultQuery/onQueryChange`、`sort/defaultSort/onSortChange`、`page/defaultPage/onPageChange`、`selectedKeys/defaultSelectedKeys/onSelectionChange`、`visibleColumns/defaultVisibleColumns/onVisibleColumnsChange`をそれぞれ制御できます。
- sortは`{ key, direction: 'ascending' | 'descending' }`です。数値は数値として、文字列はlocaleに応じて比較します。元のrowsを変更しません。
- `filter`は外部の条件、`toolbar`は絞り込みUIを配置するスロットです。検索は全列が対象です。検索・ソート操作では先頭ページに戻り、データが減った場合は表示ページを有効範囲内に収めます。
- ヘッダーのチェックボックスは**現在のページだけ**を選択します。検索・ページ移動でも選択を保持します。外部で行を削除したときのselectedKeys整理はアプリ側で行ってください。
- `columnVisibility={false}`で列メニュー、`searchable={false}`で検索を隠せます。少なくとも1列は表示します。空のcolumnsは渡さないでください。
- 表は横スクロール領域内に収まります。サーバーのページ取得、仮想化、セル直接編集は対象外です。

## 操作・動きの契約

フォーカスと状態更新をアニメーション完了まで待たせません。Buttonのloadingはフォーカスを維持し、クリックを抑止します。Tabsは左右矢印・Home/Endで選択とフォーカスを移し、非表示パネルをDOMに保持するため入力内容を維持します。Menuは上下矢印・Home/End・文字検索・Escapeを扱います。

Dialog / Drawerは`showModal()`による標準dialogです。背景の操作制限、Tabの範囲、Escape、フォーカス復帰を標準機能と組み合わせています。Popover / Menuは標準popoverで外側クリックによる閉鎖に対応します。閉じるアニメーション中はinertで操作を遮断します。開閉を制御する場合は`open`と`onOpenChange`を両方渡し、閉じた後もコンポーネントをマウントしたままにすると終了アニメーションを再生できます。triggerにはボタンそのものではなく、ボタン内の文言・アイコンを渡してください。

Tooltipのchildrenには独立したアクセシブルな名前が必要です。無効なbuttonはフォーカスできないため、必須の説明をTooltipだけに置かないでください。Toastは1インスタンスにつき1通知です。複数通知のキューやタイムアウトは含みません。読み切る時間を確保し、閉じる操作が通知内にあれば呼び出し元へフォーカスを戻します。

Skeletonを使う読み込み領域は`<div role="group" aria-label="読み込み中" aria-busy="true">`等で状態を伝えます。Skeleton自体の脈動は2回で停止します。処理が継続する不定進捗・保存中spinnerは動き軽減時に静止します。各動作は共有の120/180/240msトークンを使用し、新しいCSSに未対応のブラウザは即時切り替えへ戻ります。

日付はタイムゾーン変換をしないYYYY-MM-DDの文字列です。日付範囲の逆転はインラインエラーとネイティブのcustom validityに反映します。カレンダーとdatalistの表示・言語はブラウザ/OS依存です。

FileUploadはローカルの選択・形式/サイズ/件数検証・解除だけです。不正な選択時は直前の有効な選択を維持します。ファイルは`onValueChange`から取得してください。同じファイルを再選択できるようnative inputは都度空にするため、通常のFormDataに自動では入りません。必要に応じてアプリ側でFileをFormDataへappendします。外部から受け取るvalueの検証・サーバー検証は利用側の責任です。

ES Modulesには`use client`境界を付けています。SSR時にwindow/documentを読みません。theme=systemはサーバーではlight、ハイドレーション後にOS設定を反映するため、最初の描画の切り替えを避ける場合はサーバーで決めたthemeを明示してください。

