# CPET CosyVoice 本机侧车

可选高品质引擎：本机 [CosyVoice-300M](https://modelscope.cn/models/iic/CosyVoice-300M)，支持自定义参考音色（zero-shot）。  
日常默认请用设置里的 **EdgeTTS**（需联网、免安装）。

## 使用方式（设置里）

1. **默认关闭** TTS；开启后默认是 EdgeTTS。
2. 引擎选「CosyVoice 本机」→ CPET 自动：
   - 在 `userData/cosyvoice/venv` 创建**专用虚拟环境**（不改系统 / conda 包）
   - 按 `requirements-sidecar.txt` 向该 venv 安装运行依赖
   - 克隆 CosyVoice 仓库到 `userData/cosyvoice/CosyVoice`（含 Matcha-TTS 子模块）
   - 下载 `iic/CosyVoice-300M` 到 `userData/cosyvoice/models/…`
   - 注册一条「默认音色」供选择
3. 在音色下拉中选择 / 添加自定义音色（参考 wav + 参考文本），点试听。

高级设置里「Python」**留空**即用专用 venv。只有要强制指定其它解释器时才填写绝对路径（那时 pip 会装进你指定的环境，请自行承担风险）。

## 运行时

侧车脚本：`cpet_cosyvoice_server.py`（仅监听 `127.0.0.1`）。  
首次朗读时自动拉起；退出应用时结束进程。

## 接口

- `GET /health` → `{ ok, ready, error?, sampleRate }`
- `POST /v1/speak` JSON：`{ text, mode?, promptText?, promptWav?, spkId? }` → `audio/wav`
