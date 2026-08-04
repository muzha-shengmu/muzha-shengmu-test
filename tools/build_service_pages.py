#!/usr/bin/env python3
"""Generate the five service pages from one shared shell.

The shell (head/header/nav/hero/footer) is written once here so the pages can
never drift apart. Element ids are dictated by assets/js/mzsm-rpc-pages.js —
if you rename one here you must rename it there too.
"""
import pathlib

# 專案根目錄 = 這個檔案的上一層的上一層（tools/ 的父目錄）
ROOT = pathlib.Path(__file__).resolve().parent.parent

NAV = (
    '<nav aria-label="主要導覽" class="site-nav">'
    '<a href="index.html">首頁</a><a href="about.html">本宮</a>'
    '<a href="mazu.html">媽祖</a><a href="announcements.html">公告</a>'
    '<a href="pilgrimage.html">服務</a><a href="contact.html">聯絡</a></nav>'
)

HEADER = (
    '<header class="top"><a class="brand" href="index.html">'
    '<img alt="木柵聖母宮紅金圓形標誌" src="assets/logo.png" width="700" height="700"/>'
    '<span>木柵聖母宮</span></a>'
    '<a class="back" href="index.html">← 回首頁</a></header>'
)

SCRIPTS = (
    '<script src="assets/vendor/supabase-js-2.110.8.min.js"></script>'
    '<script src="config/announcement-config.js"></script>'
    '<script src="assets/js/mzsm-rpc-client.js"></script>'
    '<script src="assets/js/mzsm-rpc-pages.js" data-page="{page}"></script>'
)


def head(title, description):
    return (
        '<!DOCTYPE html>\n<html lang="zh-Hant"><head><meta charset="utf-8"/>'
        '<meta content="width=device-width,initial-scale=1,viewport-fit=cover" name="viewport"/>'
        '<meta content="#12100e" name="theme-color"/>'
        f'<title>{title}｜木柵聖母宮</title>\n'
        f'<meta name="description" content="{description}"/>\n'
        '<meta name="robots" content="noindex,nofollow,noarchive"/>\n'
        '<meta name="referrer" content="strict-origin-when-cross-origin"/>\n'
        '<meta name="application-name" content="木柵聖母宮"/>\n'
        '<meta name="apple-mobile-web-app-title" content="木柵聖母宮"/>\n'
        '<link rel="icon" type="image/png" sizes="32x32" href="assets/icons/favicon-32.png"/>\n'
        '<link rel="apple-touch-icon" sizes="180x180" href="assets/icons/apple-touch-icon.png"/>\n'
        '<link rel="manifest" href="manifest.webmanifest"/>'
        '<link href="site-shell.css" rel="stylesheet"/>\n'
        '<link rel="stylesheet" href="assets/css/mzsm-tokens.css"/></head><body>'
    )


def hero(latin, h1, lede):
    return (
        '<section class="hero">'
        '<img alt="宮廟屋脊金龍圖" src="assets/hero.png" width="1672" height="941"/>'
        f'<div class="hero-copy"><small class="latin">{latin}</small><h1>{h1}</h1>'
        f'<p>{lede}</p><a class="jump" href="#action">前往服務　↓</a></div></section>'
    )


def footer(label):
    return (
        '<footer class="footer"><b>木柵聖母宮</b>'
        f'<p>{label}｜正式內容以宮方公告為準。</p></footer>'
    )


def field(fid, label, control, help_text=None):
    helper = f'<p class="help">{help_text}</p>' if help_text else ""
    return f'<div class="field"><label for="{fid}">{label}</label>{control}{helper}</div>'


def text_input(fid, **attrs):
    extra = "".join(f' {k.replace("_", "-")}="{v}"' for k, v in attrs.items())
    return f'<input id="{fid}"{extra}/>'


def page(path, *, title, description, latin, h1, lede, note, body, page_id, footer_label):
    html = (
        head(title, description)
        + '<div class="site">'
        + HEADER
        + NAV
        + hero(latin, h1, lede)
        + '<main class="main">'
        + f'<div class="note"><b>{note}</b></div>'
        + body
        + footer(footer_label)
        + "</main></div>"
        + SCRIPTS.format(page=page_id)
        + "</body></html>\n"
    )
    (ROOT / path).write_text(html, encoding="utf-8")
    return len(html)


# ── 共用區塊 ─────────────────────────────────────────────────────────────
PRIVACY = (
    '<section class="section"><h2 class="heading">個資與安全</h2>'
    '<div class="grid three">'
    '<article class="card"><div class="mark">密</div><h3>只留必要欄位</h3>'
    '<p>僅保存聯絡與登記所需欄位，不會要求身分證字號或地址。</p></article>'
    '<article class="card"><div class="mark">遮</div><h3>查詢不外洩</h3>'
    '<p>線上查詢只顯示編號與狀態，不會回傳姓名或完整手機號碼。</p></article>'
    '<article class="card"><div class="mark">護</div><h3>宮務端受限</h3>'
    '<p>宮務人員也只看得到手機末四碼，且需登入授權帳號。</p></article>'
    "</div></section>"
)


def lookup_panel(panel_id, code_id, last_id, out_id, form_id, code_label, hint):
    return (
        f'<div class="panel" id="{panel_id}">'
        f'<form class="form" id="{form_id}" novalidate>'
        + field(code_id, code_label, text_input(code_id, inputmode="text", autocomplete="off",
                                                placeholder="例如：LMP-2026-0001"))
        + field(last_id, "手機末四碼",
                text_input(last_id, inputmode="numeric", autocomplete="off",
                           pattern=r"\d{4}", placeholder="0000"),
                hint)
        + '<button class="btn" type="submit">查詢</button>'
        + f'</form><div id="{out_id}"></div></div>'
    )


THROTTLE_HINT = "為防止他人猜測，同一組編號連續查錯 8 次後會暫停一小時。"

# ── 1. 南巡進香 ──────────────────────────────────────────────────────────
pilgrimage_body = (
    '<section class="section"><h2 class="heading">活動資訊</h2>'
    '<p class="intro">本宮每年定期舉辦南巡參香。2025 年公開紀錄為兩天一夜、約六百位信眾同行；'
    "各年度日期、路線、費用與名額均以本宮正式公告為準。</p>"
    '<div class="grid three">'
    '<article class="card"><h3>兩天一夜</h3><p>2025 年活動紀錄為兩天一夜；各年度天數以公告為準。</p></article>'
    '<article class="card"><h3>本宮集合</h3><p>全體由木柵聖母宮集合上車。</p></article>'
    '<article class="card"><h3>費用待公告</h3><p>正式費用以宮方公告為準，線上不收款。</p></article>'
    "</div></section>"
    '<section class="section" id="action"><h2 class="heading">報名與查詢</h2>'
    '<div class="tabs"><button type="button" data-tab="pReg" class="active">線上報名</button>'
    '<button type="button" data-tab="pFind">報名查詢</button></div>'
    '<div class="panel active" id="pReg"><form class="form" id="pilgrimageForm" novalidate>'
    + field("pName", "聯絡人姓名", text_input("pName", autocomplete="name", placeholder="王小明"))
    + field("pPhone", "手機號碼",
            text_input("pPhone", inputmode="numeric", autocomplete="tel",
                       pattern=r"\d{8,10}", placeholder="0912345678"),
            "作為聯絡與查詢用途；查詢時只需輸入末四碼。")
    + '<div class="row">'
    + field("pAdult", "成人人數", '<input id="pAdult" type="number" min="0" max="20" value="1" inputmode="numeric"/>')
    + field("pChild", "孩童人數", '<input id="pChild" type="number" min="0" max="20" value="0" inputmode="numeric"/>')
    + "</div>"
    + field("pNote", "備註（可留白）", '<textarea id="pNote" placeholder="素食、同行親友、需協助事項等"></textarea>')
    + '<p class="help" id="pFare"></p>'
    + '<button class="btn" type="submit">送出報名</button>'
    + '</form><div id="pCreated"></div></div>'
    + lookup_panel("pFind", "pCode", "pLast", "pOut", "pLookup", "報名碼", THROTTLE_HINT)
    + "</section>"
    + PRIVACY
)

# ── 2. 點燈祈福（登記＋查詢） ────────────────────────────────────────────
LIGHT_TYPES = ["平安燈", "光明燈", "太歲燈", "文昌燈", "財利燈"]
light_type_select = (
    '<select id="lType">'
    + "".join(f'<option value="{t}">{t}</option>' for t in LIGHT_TYPES)
    + "</select>"
)


def light_register_form():
    return (
        '<form class="form" id="lightForm" novalidate>'
        + field("lName", "登記人姓名", text_input("lName", autocomplete="name", placeholder="王小明"))
        + field("lPhone", "手機號碼",
                text_input("lPhone", inputmode="numeric", autocomplete="tel",
                           pattern=r"\d{8,10}", placeholder="0912345678"))
        + field("lType", "燈別", light_type_select)
        + field("lTarget", "祈福對象", text_input("lTarget", placeholder="為誰祈福，例如：王大明"))
        + field("lBirth", "國曆生日（可留白）", text_input("lBirth", placeholder="例如：2000-01-01（國曆）"))
        + field("lNote", "備註（可留白）", '<textarea id="lNote" placeholder="祈願內容或需說明事項"></textarea>')
        + '<button class="btn" type="submit">送出登記</button>'
        + '</form><div id="lCreated"></div>'
    )


light_body = (
    '<section class="section"><h2 class="heading">點燈說明</h2>'
    '<p class="intro">點燈為本宮常年服務，燈別、金額與安燈時程以宮方正式公告為準；'
    "線上僅受理登記，不進行收款。</p></section>"
    '<section class="section" id="action"><h2 class="heading">登記與查詢</h2>'
    '<div class="tabs"><button type="button" data-tab="lReg" class="active">線上登記</button>'
    '<button type="button" data-tab="lFind">登記查詢</button></div>'
    '<div class="panel active" id="lReg">' + light_register_form() + "</div>"
    + lookup_panel("lFind", "lCode", "lLast", "lOut", "lightQuery", "點燈碼", THROTTLE_HINT)
    + "</section>"
    + PRIVACY
)

# ── 3. 點燈登記（只有登記） ──────────────────────────────────────────────
light_register_body = (
    '<section class="section" id="action"><h2 class="heading">點燈線上登記</h2>'
    '<p class="intro">填寫後會取得一組點燈碼，可於「點燈查詢」以點燈碼與手機末四碼查看狀態。</p>'
    + light_register_form()
    + "</section>"
    + '<section class="section"><h2 class="heading">其他</h2><div class="grid three">'
    '<article class="card"><h3>查詢登記</h3><p>已登記過可查看目前狀態。</p>'
    '<a class="btn" href="light-query.html">前往點燈查詢</a></article>'
    '<article class="card"><h3>完整服務頁</h3><p>同時提供登記與查詢。</p>'
    '<a class="btn" href="light.html">前往點燈祈福</a></article>'
    '<article class="card"><h3>金額</h3><p>線上不收款，金額與繳費方式以宮方公告為準。</p></article>'
    "</div></section>"
)

# ── 4. 點燈查詢（只有查詢） ──────────────────────────────────────────────
light_query_body = (
    '<section class="section" id="action"><h2 class="heading">點燈登記查詢</h2>'
    '<p class="intro">請輸入登記時取得的點燈碼，以及登記手機的末四碼。</p>'
    '<form class="form" id="completeQuery" novalidate>'
    + field("cqCode", "點燈碼", text_input("cqCode", autocomplete="off", placeholder="例如：LMP-2026-0001"))
    + field("cqLast", "手機末四碼",
            text_input("cqLast", inputmode="numeric", autocomplete="off",
                       pattern=r"\d{4}", placeholder="0000"),
            THROTTLE_HINT)
    + '<button class="btn" type="submit">查詢</button>'
    + '</form><div id="cqOut"></div></section>'
)

# ── 5. 安太歲 ────────────────────────────────────────────────────────────
taisui_body = (
    '<section class="section"><h2 class="heading">安太歲說明</h2>'
    '<p class="intro">安太歲以國曆生日登記，農曆日期與生肖由宮方人工核對，本網站不做自動換算。</p>'
    "</section>"
    '<section class="section"><div class="card"><h3>生日輸入（不在前端換算）</h3>'
    '<p>可輸入西元或民國年；本頁只提交原始國曆生日。</p>'
    '<div class="tabs" id="birthModes">'
    '<button type="button" data-mode="western" class="active">西元</button>'
    '<button type="button" data-mode="roc">民國</button></div>'
    '<div class="row">'
    + field("tYear", '<span id="tYearLabel">西元年</span>',
            '<input id="tYear" type="number" inputmode="numeric" placeholder="2000"/>')
    + field("tMonth", "月", '<input id="tMonth" type="number" min="1" max="12" inputmode="numeric" placeholder="1"/>')
    + "</div><div class=\"row\">"
    + field("tDay", "日", '<input id="tDay" type="number" min="1" max="31" inputmode="numeric" placeholder="1"/>')
    + field("tPicker", "或直接選擇日期", '<input id="tPicker" type="date"/>')
    + "</div>"
    + '<p class="help" id="tPreview"></p></div></section>'
    + '<section class="section" id="action"><h2 class="heading">登記與查詢</h2>'
    '<div class="tabs"><button type="button" data-tab="tReg" class="active">線上登記</button>'
    '<button type="button" data-tab="tFind">登記查詢</button></div>'
    '<div class="panel active" id="tReg"><form class="form" id="tsForm" novalidate>'
    + field("tName", "登記人姓名", text_input("tName", autocomplete="name", placeholder="王小明"))
    + field("tPhone", "手機號碼",
            text_input("tPhone", inputmode="numeric", autocomplete="tel",
                       pattern=r"\d{8,10}", placeholder="0912345678"))
    + field("tTarget", "祈福對象", text_input("tTarget", placeholder="為誰安太歲，例如：王大明"))
    + field("tNote", "備註（可留白）", '<textarea id="tNote" placeholder="祈願內容或需說明事項"></textarea>')
    + '<p class="help">生日請於上方「生日輸入」區填寫，送出時會一併提交。</p>'
    + '<button class="btn" type="submit">送出登記</button>'
    + '</form><div id="tCreated"></div></div>'
    + lookup_panel("tFind", "tCode", "tLast", "tOut", "tsQuery", "安太歲碼", THROTTLE_HINT)
    + "</section>"
    + PRIVACY
)

PAGES = [
    dict(path="pilgrimage.html", page_id="pilgrimage", title="南巡進香",
         description="木柵聖母宮南巡進香線上報名與報名查詢。活動日期、辦法與費用以宮方公告為準。",
         latin="ANNUAL PILGRIMAGE", h1="南巡進香",
         lede="年度進香活動線上報名與查詢。",
         note="線上報名已開放；活動日期、路線、費用與名額仍以本宮正式公告為準，本頁不收款。",
         body=pilgrimage_body, footer_label="南巡進香"),
    dict(path="light.html", page_id="light", title="點燈祈福",
         description="木柵聖母宮點燈祈福線上登記與查詢。燈別、金額與安燈時程以宮方公告為準。",
         latin="BLESSING LAMPS", h1="點燈祈福",
         lede="平安燈、光明燈等點燈線上登記與查詢。",
         note="線上登記已開放；燈別、金額與安燈時程以本宮正式公告為準，本頁不收款。",
         body=light_body, footer_label="點燈祈福"),
    dict(path="light-register.html", page_id="light", title="點燈線上登記",
         description="木柵聖母宮點燈線上登記表單。",
         latin="LAMP REGISTRATION", h1="點燈線上登記",
         lede="填寫後取得點燈碼，可隨時查詢狀態。",
         note="線上登記已開放；本頁不收款，金額與繳費方式以本宮正式公告為準。",
         body=light_register_body, footer_label="點燈線上登記"),
    dict(path="light-query.html", page_id="light-query", title="點燈查詢",
         description="以點燈碼與手機末四碼查詢點燈登記狀態。",
         latin="LAMP LOOKUP", h1="點燈查詢",
         lede="以點燈碼與手機末四碼查詢登記狀態。",
         note="查詢結果只顯示點燈碼、燈別、祈福對象與狀態，不會顯示姓名或完整手機號碼。",
         body=light_query_body, footer_label="點燈查詢"),
    dict(path="taisui.html", page_id="taisui", title="安太歲",
         description="木柵聖母宮安太歲線上登記與查詢。農曆與生肖由宮方人工核對。",
         latin="TAI SUI BLESSING", h1="安太歲",
         lede="安太歲線上登記與查詢；農曆與生肖由宮方核對。",
         note="線上登記已開放；農曆日期與生肖由宮方人工核對，本頁不做自動換算，也不收款。",
         body=taisui_body, footer_label="安太歲"),
]

if __name__ == "__main__":
    for spec in PAGES:
        size = page(**spec)
        print(f"{spec['path']:24s} {size:6d} bytes  data-page={spec['page_id']}")
