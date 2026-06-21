<template>
    <div class="nx-settings script-docs">
        <section class="nx-group">
            <div class="nx-group__head">
                <h3>运行模型</h3>
                <p>
                    脚本由 NexTerm 主进程在本机执行，stdout/stderr 写回目标终端；目标终端只接收 term API
                    下发的真实输入并返回回显。
                </p>
            </div>

            <div class="doc-block">
                <div class="doc-title">运行环境</div>
                <p>
                    JavaScript 使用 NexTerm 自带的 Electron/Node 运行时，不要求目标机器安装 node。Python、Tcl、Shell
                    需要 NexTerm 所在机器有 python3/python、tclsh、sh；SSH/Telnet/Serial 目标端不需要这些解释器，除非脚本自己通过
                    term.send 下发远端命令去调用。
                </p>
            </div>

            <div class="doc-block">
                <div class="doc-title">核心 API</div>
                <pre><code>term.send(text)
term.expect(pattern, timeout = 5000)
term.exec(command, options)
term.print(text)</code></pre>
                <p>
                    send 只发送输入，末尾需要回车时用 \n；expect 等待目标终端后续输出匹配字符串；exec
                    等价于发送命令并等待提示符，会自动补回车；print 只用于脚本额外输出。 send/exec
                    下发的命令会在目标终端真实显示，返回值用于脚本判断，不需要再 print。
                </p>
            </div>
        </section>

        <section class="nx-group">
            <div class="nx-group__head">
                <h3>JavaScript</h3>
                <p>脚本以 ES module 执行，支持 import 和 top-level await。</p>
            </div>

            <pre><code>const out = await term.exec("pwd", {
    expect: "$ ",
    timeout: 5000
});
if (out.includes("/home")) {
    term.print("cwd ok\n");
}</code></pre>
        </section>

        <section class="nx-group">
            <div class="nx-group__head">
                <h3>Python</h3>
                <p>同步调用，返回匹配到指定回显为止的终端输出。</p>
            </div>

            <pre><code>out = term.exec("pwd", expect="$ ", timeout=5000)
if "/home" in out:
    term.print("cwd ok\n")</code></pre>
        </section>

        <section class="nx-group">
            <div class="nx-group__head">
                <h3>Tcl / Shell</h3>
                <p>Tcl 使用 term 子命令；Shell 使用 term_* 函数。</p>
            </div>

            <pre><code># Tcl
set out [term exec "pwd" "$ " 5000]
if {[string first "/home" $out] >= 0} {
    term print "cwd ok\n"
}

# Shell
out=$(term_exec "pwd" "$ " 5000)
case "$out" in
    */home*) term_print "cwd ok\n" ;;
esac</code></pre>
        </section>
    </div>
</template>

<style scoped>
    .script-docs {
        line-height: 1.5;
    }
    .doc-block {
        display: grid;
        gap: 8px;
        padding: 10px 0;
    }
    .doc-title {
        color: var(--nx-text);
        font-size: 12px;
        font-weight: 700;
    }
    p {
        margin: 0;
        color: var(--nx-text-dim);
        font-size: 11px;
    }
    pre {
        margin: 10px 0 0;
        padding: 10px;
        overflow: auto;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-bg);
        color: var(--nx-text);
        font-family: var(--nx-font-mono);
        font-size: 11px;
        white-space: pre;
    }
</style>
