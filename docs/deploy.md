# Docker / Kubernetes で動かす

API と Web は 1 つの Node.js プロセスで動く。Web のファイルはビルド時にイメージへ入れ、API サーバーが配信する。DB は SQLite と PostgreSQL から選べる。

まず Docker で試すなら SQLite と JSON キー、Kubernetes で常用するなら SQLite または外部 PostgreSQL と WIF、という組み合わせで始められる。どちらも OIDC の IdP、solidtime、Google Workspace 側の準備が必要になる。

## 先に用意するもの

- OIDC のクライアント。戻り先は公開 URL の `/auth/callback` にする。
- solidtime の URL、組織 ID、personal access token。トークンのユーザーには、対象組織の全員の打刻を読める権限が必要。admin か owner がおすすめだが、solidtime の manager でも読める。打刻はユーザーで絞らず、案件ごとに取り込む。権限が足りないと、同期は失敗として記録される。
- Google のサービスアカウントと、そのアカウントに共有したカレンダー・共有ドライブ。
- 32 文字以上のランダムな `SESSION_SECRET`。再起動のたびに変えず、同じ値を使う。

設定項目は [`.env.example`](../.env.example) にコメントつきで並べてある。空欄の秘密情報は利用環境で設定する。実際のトークン、パスワード、JSON キーはコミットしない。`.env.local` はこの手順では使わない。

### Google の共有設定

1. Google Cloud のプロジェクトで Calendar API と Drive API を有効にし、専用のサービスアカウントを作る。
2. 読みたいカレンダーを、そのサービスアカウントのメールアドレスに「予定の詳細を表示」以上で共有する。カレンダー ID を `GOOGLE_CALENDAR_ID` に設定する。本人のカレンダーなのでといって `primary` にはしない。
3. Google Workspace の共有ドライブにサービスアカウントを「コンテンツ管理者」として追加する。その中にアプリ用の親フォルダーを作り、サービスアカウントが共有権限を引き継いで読み書きできることを確かめる。フォルダーの共有を個別に制限している場合は、そこにも追加する。
4. 共有ドライブ ID を `GOOGLE_DRIVE_ID`、親フォルダー ID を `GOOGLE_DRIVE_ROOT_FOLDER_ID` に設定する。

マイドライブのフォルダーを共有するだけでは、サービスアカウントの保存容量がないためアップロードに失敗する。保存先は共有ドライブにする。[Google Drive のサービスアカウントに関する説明](https://developers.google.com/workspace/drive/api/guides/about-shareddrives)

ドメイン全体の委任は使わない。ユーザーの代理として動かさず、共有先のサービスアカウントとしてアクセスする。実装が要求するスコープは `calendar.events.readonly` と `drive`。スコープを指定するだけでは共有権限は付かない。

起動できたら、実際のカレンダーに Out of Office を 1 件入れて同期し、不在時間が反映されるか確かめる。`/readyz` は DB の確認までなので、Google の共有設定が正しいかは分からない。

## Docker Compose

リポジトリ直下で実行する。

```sh
cp .env.example .env
mkdir -p secrets
```

`.env` のダミー値を自分の設定に替え、`SOLIDTIME_API_TOKEN`、`OIDC_CLIENT_SECRET`、`SESSION_SECRET` を設定する。`OIDC_CLIENT_ASSERTION_FILE` は空欄のままにする。

Google の JSON キーは `secrets/google-credentials.json` に置く。ここは gitignore と Docker のビルド対象から除外してある。Compose はこのファイルを読み取り専用でマウントする。コンテナの UID/GID は `1000:1000` なので、このユーザーがキーを読めるようにホスト側の所有者・権限を調整する。ファイルがない場合、Compose は空のディレクトリを勝手に作らずエラーにする。

```sh
docker compose --env-file .env up -d --build
docker compose logs -f app
```

`http://localhost:3000` を開く。`.env.example` はこの HTTP 接続用に `SECURE_COOKIES=false` にしてある。HTTPS のリバースプロキシで公開するときは `true` に戻し、`OIDC_REDIRECT_URI` と IdP 側の戻り先を公開 URL にそろえる。ポートは localhost にだけ公開する設定なので、別ホストから直接接続する構成では `ports` も調整する。

```sh
curl --fail http://localhost:3000/api/health
curl --fail http://localhost:3000/readyz
curl --fail http://localhost:3000/
```

`/api/health` はプロセスの応答、`/readyz` は DB に問い合わせできること、`/` は Web の `index.html` を確認できる。ポートを変更した場合は URL も替える。

SQLite は名前付きボリューム `data` の `/data/fpm.sqlite` に保存する。`docker compose down` だけなら残るが、`down -v` は DB も消す。止めるだけなら `docker compose stop app` を使う。

イメージだけを作る場合は次のコマンドでよい。

```sh
docker build -t fpm:local .
```

Node.js 24 の Debian slim を使い、ビルド中に `node:sqlite` を実際に開けるか確認している。実行イメージにコピーするのはサーバーのビルド結果・package.json・本番依存と Web の dist だけ。ワークスペースの TypeScript はサーバーへバンドルするので、元のソースや開発ツールは不要になる。

## Kubernetes

### ファイルの分け方

| 場所 | 内容 |
| --- | --- |
| `deploy/kubernetes/base` | Deployment、ServiceAccount、ClusterIP Service、公開設定、WIF の JSON |
| `overlays/sqlite` | SQLite の設定と ReadWriteOnce の PVC (5 GiB) |
| `overlays/postgres` | `DB_KIND=postgres` と Secret からの `DATABASE_URL` |
| `overlays/ingress` | SQLite に Ingress を加えた例 |
| `examples` | 空の Secret と、利用環境用の Kustomization のひな形 |

Namespace はどのファイルにも付けていない。利用側で選ぶ。base はどの構成でも使う共通の設定で、単体では DB を選ばないよう `DB_KIND` を空にしてある。必ず SQLite か PostgreSQL の overlay を使う。

SQLite の PVC は既定の StorageClass を使う。必要なら `storageClassName` を指定する。ストレージ側が `fsGroup: 1000` に対応し、UID 1000 が `/data` に書き込めることも確認する。

PostgreSQL は既存の DB を使う想定で、このマニフェストから DB サーバーを作ることはない。`fpm-secrets` の `DATABASE_URL` に接続文字列を入れる。TLS の接続設定は利用する DB に合わせる。SQLite の PVC は作られず、`/data` は未使用の一時領域になる。overlay を替えても DB の中身は自動移行されない。

### 利用環境の設定を重ねる

先にイメージをレジストリへ push し、各ノードから取得できるようにする。プライベートレジストリなら利用環境の `imagePullSecrets` も設定する。

```sh
mkdir -p deploy/kubernetes/overlays/local
cp deploy/kubernetes/examples/kustomization.yaml.example deploy/kubernetes/overlays/local/kustomization.yaml
sed '/^DB_KIND=/d' deploy/kubernetes/base/config.env > deploy/kubernetes/overlays/local/config.env
cp deploy/kubernetes/base/google-wif.json deploy/kubernetes/overlays/local/google-wif.json
```

`overlays/local/` は gitignore 済み。次を編集する。

- `kustomization.yaml`: `resources` で DB の overlay を選び、`images` のレジストリとリリースタグを設定する。`fpm-token-audiences` の `oidc` と `google` も自分の値にする。
- `config.env`: 公開 URL、各サービスの ID、許可するユーザーを設定する。DB の選択は SQLite / PostgreSQL overlay に任せるため、このファイルには `DB_KIND` を書かない。秘密情報もここには入れない。
- `google-wif.json`: 次節で作る credential configuration に差し替える。

audience の置換は、この利用側の Kustomization で行う。ConfigMap の値を Deployment 内の 2 つの projected token へ `replacements` で渡すので、長いフィールドパスを毎回編集しなくてよい。

`examples/secret.yaml.example` は形だけの例で、Kustomize の出力には含めない。利用する Namespace に `fpm-secrets` を別途用意する。必須のキーは `SESSION_SECRET` と `SOLIDTIME_API_TOKEN`。PostgreSQL なら `DATABASE_URL`、OIDC の client secret を使うなら `OIDC_CLIENT_SECRET` も入れる。Secret 管理ツールなどから渡し、実値の YAML やレンダリング結果を Git に入れない。

クラスターに接続せず、手元で組み立てを確認できる。

```sh
kubectl kustomize deploy/kubernetes/base
kubectl kustomize deploy/kubernetes/overlays/sqlite
kubectl kustomize deploy/kubernetes/overlays/postgres
kubectl kustomize deploy/kubernetes/overlays/ingress
kubectl kustomize deploy/kubernetes/overlays/local
```

実際に配置するときは、利用側で Namespace と Secret を用意してから適用する。以下は運用時の手順で、この実装の検証では実行しない。

```sh
kubectl -n YOUR_NAMESPACE apply -k deploy/kubernetes/overlays/local
kubectl -n YOUR_NAMESPACE rollout status deployment/fpm
kubectl -n YOUR_NAMESPACE port-forward service/fpm 3000:80
```

公開する場合は Ingress のホスト名、`ingressClassName`、TLS Secret を利用環境に合わせる。`overlays/ingress` は SQLite の例なので、PostgreSQL と組み合わせるなら参照先を `../postgres` に替える。HTTPS へのリダイレクトは使っている Ingress controller で設定する。

### Google の WIF

`GOOGLE_CLOUD_PROJECT` に Google Cloud のプロジェクト ID (プロジェクト番号ではない)を設定する。`deploy/kubernetes/base/config.env` と `.env.example` の `example-project-id` を置き換える。WIF では未設定だと `google-auth-library` がプロジェクト ID を自動探索し、Calendar・Drive 用のスコープだけでは失敗するため、必ず明示する。

この構成では Kubernetes の ServiceAccount トークンを Google STS で交換し、Google のサービスアカウントを impersonate する。そのアカウントへ Calendar / Drive を共有する。Google Workspace ユーザーの代理アクセスやドメイン全体の委任とは別の仕組みになる。

設定は次の順で進める。

1. Google Cloud で IAM、Security Token Service、IAM Service Account Credentials API を有効にする。
2. クラスターの ServiceAccount issuer と署名公開鍵 (JWKS) を確認する。外部から issuer にアクセスできないクラスターでは、Google の provider に JWKS を登録する方式が使える。鍵をローテーションしたら登録済み JWKS も更新する。
3. Workload Identity Pool と OIDC provider を作る。`google.subject=assertion.sub` をマッピングし、対象を `system:serviceaccount:YOUR_NAMESPACE:fpm` に絞る。必要なら provider の attribute condition でも制限する。
4. Google のサービスアカウントに対し、その subject だけに `roles/iam.workloadIdentityUser` を付ける。pool 全体には広げない。
5. credential configuration を生成して ConfigMap に入れ、projected token の audience を provider が受け付ける値に合わせる。

サービスアカウントへの IAM バインディングで指定する member は、この形になる。

```text
principal://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/subject/system:serviceaccount:YOUR_NAMESPACE:fpm
```

上の準備を済ませたあとの生成コマンドの例。大文字の部分を自分の値に替える。

```sh
gcloud iam workload-identity-pools create-cred-config \
  projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID \
  --service-account=fpm@PROJECT_ID.iam.gserviceaccount.com \
  --credential-source-file=/var/run/secrets/google-token/token \
  --credential-source-type=text \
  --output-file=deploy/kubernetes/overlays/local/google-wif.json
```

この JSON には秘密鍵が入らないので ConfigMap で渡せる。`credential_source.file` は Google 用トークンのマウント先、`GOOGLE_APPLICATION_CREDENTIALS` はこの JSON のマウント先を指す。設定の詳しい手順は [Google の Kubernetes 向け WIF ガイド](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-kubernetes) を参照。

例では JSON の `audience` は `//iam.googleapis.com/projects/.../providers/...`、projected token の audience は `https://iam.googleapis.com/projects/.../providers/...` にしている。どちらも同じ provider を指す。provider に独自の allowed audiences を設定する場合、projected token の側をその値に替える。OIDC ログイン用トークンの audience とは別に管理する。

ServiceAccount の通常の API トークンは自動マウントせず、用途別の短命トークンだけを投影する。トークンのファイルはディレクトリごとマウントし、`subPath` は使わない。これで kubelet が更新したトークンを読める。[Kubernetes の projected volume の説明](https://kubernetes.io/docs/concepts/storage/projected-volumes/)

### Google の JSON キーを使う場合

Docker Compose では前述の読み取り専用マウントを使う。Kubernetes でも WIF が使えなければ、キーを `fpm-google-key` という Secret の `credentials.json` キーに登録し、利用側の Kustomization に次の patch を追加する。実際の JSON キーを ConfigMap に入れない。

```yaml
patches:
  - target:
      kind: Deployment
      name: fpm
    patch: |-
      apiVersion: apps/v1
      kind: Deployment
      metadata:
        name: fpm
      spec:
        template:
          spec:
            volumes:
              - name: google-credentials
                configMap: null
                secret:
                  secretName: fpm-google-key
                  defaultMode: 0440
```

`GOOGLE_APPLICATION_CREDENTIALS` とマウント先は同じままでよい。この patch では Google 用の projected token と WIF ConfigMap は残るが、認証には使わない。

### OIDC の client secret / WIF

Google 向け WIF と、OIDC クライアントの認証は独立している。Google を WIF にして OIDC は client secret、という組み合わせも使える。

client secret の場合は IdP が `client_secret_basic` を受け付ける設定にする。Kubernetes では `config.env` の `OIDC_CLIENT_ASSERTION_FILE` を空にし、`fpm-secrets` に `OIDC_CLIENT_SECRET` を登録したうえで、利用側に次の patch を加える。

```yaml
patches:
  - target:
      kind: Deployment
      name: fpm
    patch: |-
      apiVersion: apps/v1
      kind: Deployment
      metadata:
        name: fpm
      spec:
        template:
          spec:
            containers:
              - name: app
                env:
                  - name: OIDC_CLIENT_SECRET
                    valueFrom:
                      secretKeyRef:
                        name: fpm-secrets
                        key: OIDC_CLIENT_SECRET
```

Google の JSON キー用 patch と併用するなら、`patches` を重複して書かず、同じリストに並べる。この場合も OIDC 用トークンはマウントされたままだが、使われない。

WIF の場合は base の `OIDC_CLIENT_ASSERTION_FILE=/var/run/secrets/oidc/token` を使い、client secret は設定しない。IdP にクラスターの issuer、ServiceAccount の subject、受け付ける audience を登録する。アプリはファイルの JWT を、トークン交換のたびに読み直して `client_assertion` として送る。

IdP が外部発行の ServiceAccount JWT をクライアント認証に使えることが前提になる。単に `private_key_jwt` という方式があるだけでは十分ではない。IdP の federated credential の仕様に合わせて信頼を設定する。`OIDC_CLIENT_SECRET` と `OIDC_CLIENT_ASSERTION_FILE` の両方に値を入れると起動時にエラーになる。

`ALLOWED_EMAIL` / `ALLOWED_SUB` はログインする本人の許可設定で、ServiceAccount の subject とは別。片方以上が必要で、両方を指定した場合はどちらかの一致でログインできる。メールによる許可には `email_verified=true` も必要になる。

## 1 レプリカと停止時の動き

同期の排他制御はプロセスの中にしかない。複数 Pod を同時に動かすと、先に取得した古い結果を後から保存し、新しいデータを上書きする可能性がある。そのため DB が PostgreSQL でも `replicas: 1`、更新戦略は `Recreate` にする。HPA で増やさず、同じ DB に別の Deployment や Compose から同時接続して同期しない。

Recreate は更新時に旧 Pod を止めてから新しい Pod を起動するので、更新中は短い停止時間がある。Pod の強制削除などでは旧プロセスの終了を待てないことがあるため、通常の Deployment 更新を使う。

アプリは SIGTERM を受けると新しい HTTP 接続と定期同期を止め、処理中のリクエストと同期が終わってから DB を閉じる。Compose と Kubernetes の終了猶予は 60 秒にしてある。実環境で同期がそれ以上かかるなら猶予を延ばす。

コンテナは UID/GID `1000:1000` で動き、ルートファイルシステムは読み取り専用。アプリの書き込み先は `/data` と `/tmp` だけにしている。Kubernetes の CPU / メモリー指定は最初の目安なので、同期時の使用量を見て調整する。

## SQLite のバックアップ

いちばん分かりやすい方法は、アプリを止めて `/data` を丸ごと保存すること。動作中の `fpm.sqlite` だけをコピーすると、ジャーナルや WAL との不整合が起きることがある。

Compose なら次の手順で、ボリューム内のファイルをホストへ取り出せる。`run` はアプリを起動せず tar だけを実行する。

```sh
mkdir -p backups
docker compose stop app
docker compose run --rm --no-deps -T --entrypoint tar app -C /data -cf - . > backups/fpm-data.tar
docker compose start app
```

`backups/` も gitignore 済み。保存のたびに別のファイル名を付け、サーバーとは別の場所にもコピーする。終了猶予を超えて強制終了された場合は、その状態を確認してからバックアップする。

復元はアプリを止めた状態で、**空のボリューム**にアーカイブを展開する。古い journal / WAL ファイルと混ぜない。UID/GID `1000:1000` が読めて書ける状態にしてから起動し、`/readyz` と画面のデータを確認する。

Kubernetes では Deployment を 0 レプリカにし、Pod が終了して PVC の利用が止まったことを確かめてから保存する。同じ PVC をマウントする一時 Pod でファイルを取り出すか、ストレージのスナップショットを使う。バックアップ用 Pod からアプリを起動しない。復元先は新しい PVC にし、参照先を替えて 1 レプリカに戻す。PVC を削除する前には PV の reclaim policy も確認する。

## 起動できないとき

- `Invalid configuration: ...`: 表示された環境変数を確認する。整数項目は空文字にせず、有効な数値を入れる。`SESSION_SECRET` は 32 文字以上必要。
- `Server startup failed`: DB の接続・マイグレーション、OIDC discovery、静的ファイルの読み込みを確認する。IdP は起動時から HTTPS で到達できる必要がある。ダミーの issuer のままでは HTTP サーバーも起動しない。
- `/readyz` が 200 なのに同期できない: solidtime の設定、Google の ADC、Calendar / Drive の共有を確認する。同期は起動直後にも実行するが、外部サービスの同期失敗だけではヘルスチェックは失敗しない。
- SQLite の権限エラー: 既存のボリュームの所有者と StorageClass の `fsGroup` 対応を確認する。readOnlyRootFilesystem を解除する必要はない。

実装の検証は `docker build`、コンテナへの HTTP アクセス、`kubectl kustomize`、`npx vitest run`、`npm run typecheck` で行う。ログイン・Google 同期・共有ドライブへのアップロードは、各サービスに実際の設定を入れたあとで確認する。
