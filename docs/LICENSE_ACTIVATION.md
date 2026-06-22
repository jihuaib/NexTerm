# NexTerm 离线激活

NexTerm 使用 Ed25519 签名的 `license.json` 做离线激活。客户端只内置公钥，授权端保留私钥。

## 1. 生成授权密钥

```bash
npm run license:keygen -- --out license-keys --install-public-key
```

这会生成：

- `license-keys/nexterm-license-private.pem`：授权端私钥，只能放在签发环境。
- `license-keys/nexterm-license-public.pem`：公钥。
- `electron/assets/license-public.pem`：客户端会读取的公钥文件，打包前需要保留。

私钥目录已经加入 `.gitignore`，不要提交私钥。

如果重新生成了密钥，需要重新安装客户端公钥并重启 NexTerm：

```bash
npm run license:keygen -- --out license-keys --install-public-key --force
```

## 2. 用户导出激活请求

用户在 NexTerm 打开：

```text
设置 -> 授权 -> 保存请求文件
```

得到 `activation-request.json`，里面包含机器码。

## 3. 签发授权文件

```bash
npm run license:sign -- activation-request.json \
  --private-key license-keys/nexterm-license-private.pem \
  --subject "客户名称" \
  --days 365 \
  --out license.json
```

常用参数：

- `--days 365`：授权有效天数，默认 365。
- `--expires-at 2027-06-22T00:00:00.000Z`：指定到期时间。
- `--permanent`：永久授权，不写 `expiresAt`。
- `--machine-id "*"`：不绑定机器，不推荐正式授权使用。
- `--features "*,sftp"`：功能列表，默认 `*`。
- `--edition Pro`：授权版本名。
- `--license-id lic-xxx`：授权 ID，不传会自动生成。

## 4. 验证授权文件

```bash
npm run license:verify -- license.json --public-key license-keys/nexterm-license-public.pem
```

验证通过后，把 `license.json` 发给用户。

如果客户端导入时报 `授权签名无效`，用客户端实际公钥再验证一次：

```bash
npm run license:verify -- license.json --public-key electron/assets/license-public.pem
```

这里失败，说明签发私钥和客户端公钥不是一对，或者 `license.json` 签发后被修改过。重新用当前客户端公钥对应的私钥签发即可。

## 5. 用户导入授权

用户在 NexTerm 打开：

```text
设置 -> 授权 -> 选择授权文件
```

也可以把 `license.json` 内容粘贴到授权输入框后点击 `导入授权`。

需要撤销本机授权时，在同一页面点击 `移除授权`。这个操作只清空已导入的授权文件，不会重置机器码、试用开始时间或试用到期时间。

## Dev 调试说明

dev 环境也可以绑定机器。机器码会在首次启动时写入应用数据目录的 `data/install.json`，后续启动只读取这个持久化值，不会按网卡或主机信息重新计算。绑定依据是 NexTerm 设置页里显示的 `机器码`，最稳妥的方式是从同一个 dev 应用导出 `activation-request.json` 后签发：

```bash
npm run license:sign -- activation-request.json \
  --private-key license-keys/nexterm-license-private.pem \
  --subject "Dev" \
  --days 30 \
  --out license.json
```

如果出现 `授权文件不属于当前机器`，通常是以下情况：

- 签发时用了文档或命令里的示例机器码。
- 使用了旧的 `activation-request.json`。
- dev 启动时切换了 `NEXTERM_USER_DATA_DIR`。
- 删除过应用数据目录里的 `data/install.json`，机器码会重新生成。

只做本地 UI 调试、不需要绑定机器时，可以签发不绑定机器的授权：

```bash
npm run license:sign -- \
  --machine-id "*" \
  --private-key license-keys/nexterm-license-private.pem \
  --subject "Dev" \
  --days 30 \
  --out license.json
```
