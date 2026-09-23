from pathlib import Path
from sys import argv

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(argv[1]).resolve() if len(argv) > 1 else ROOT / "public" / "help" / "LagosPM-Help.pdf"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

INK = colors.HexColor("#172033")
MUTED = colors.HexColor("#607089")
RULE = colors.HexColor("#d9e0ea")
PAPER = colors.HexColor("#f7f9ff")
SURFACE = colors.white
COBALT = colors.HexColor("#2457d6")
COBALT_DARK = colors.HexColor("#173b97")
GREEN = colors.HexColor("#197149")
AMBER = colors.HexColor("#9a5b00")
RED = colors.HexColor("#a52d32")

base = getSampleStyleSheet()
styles = {
    "title": ParagraphStyle(
        "Title",
        parent=base["Title"],
        fontName="Helvetica-Bold",
        fontSize=30,
        leading=34,
        textColor=INK,
        alignment=TA_LEFT,
        spaceAfter=12,
    ),
    "eyebrow": ParagraphStyle(
        "Eyebrow",
        parent=base["Normal"],
        fontName="Courier-Bold",
        fontSize=8,
        leading=11,
        textColor=COBALT,
        tracking=1.3,
        spaceAfter=7,
    ),
    "h1": ParagraphStyle(
        "H1",
        parent=base["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=22,
        leading=27,
        textColor=INK,
        spaceBefore=2,
        spaceAfter=12,
    ),
    "h2": ParagraphStyle(
        "H2",
        parent=base["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=17,
        textColor=INK,
        spaceBefore=12,
        spaceAfter=6,
    ),
    "body": ParagraphStyle(
        "Body",
        parent=base["BodyText"],
        fontName="Helvetica",
        fontSize=9.5,
        leading=14,
        textColor=INK,
        spaceAfter=7,
    ),
    "small": ParagraphStyle(
        "Small",
        parent=base["BodyText"],
        fontName="Helvetica",
        fontSize=8,
        leading=11,
        textColor=MUTED,
    ),
    "bullet": ParagraphStyle(
        "Bullet",
        parent=base["BodyText"],
        fontName="Helvetica",
        fontSize=9.5,
        leading=14,
        leftIndent=12,
        firstLineIndent=-8,
        bulletIndent=0,
        textColor=INK,
        spaceAfter=5,
    ),
    "callout": ParagraphStyle(
        "Callout",
        parent=base["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=13,
        textColor=COBALT_DARK,
    ),
    "table_head": ParagraphStyle(
        "TableHead",
        parent=base["BodyText"],
        fontName="Courier-Bold",
        fontSize=7.5,
        leading=10,
        textColor=MUTED,
    ),
    "table": ParagraphStyle(
        "Table",
        parent=base["BodyText"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=12,
        textColor=INK,
    ),
}


def p(text, style="body"):
    return Paragraph(text, styles[style])


def bullet(text):
    return Paragraph(f"• {text}", styles["bullet"])


def section(title, body):
    return KeepTogether([p(title, "h2"), *body])


def table(headers, rows, widths):
    data = [[p(value, "table_head") for value in headers]]
    data.extend([[p(str(value), "table") for value in row] for row in rows])
    result = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    result.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), PAPER),
                ("TEXTCOLOR", (0, 0), (-1, -1), INK),
                ("GRID", (0, 0), (-1, -1), 0.45, RULE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return result


def callout(text, color=COBALT):
    content = Table([[p(text, "callout")]], colWidths=[165 * mm])
    content.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PAPER),
                ("LINEBEFORE", (0, 0), (0, -1), 3, color),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ]
        )
    )
    return content


def page_decor(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(COBALT)
    canvas.rect(0, height - 4 * mm, width, 4 * mm, stroke=0, fill=1)
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(22 * mm, 16 * mm, width - 22 * mm, 16 * mm)
    canvas.setFont("Courier", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(22 * mm, 10.5 * mm, "LAGOSPM · USER AND OPERATIONS GUIDE · VERSION 1.0")
    canvas.drawRightString(width - 22 * mm, 10.5 * mm, f"PAGE {doc.page}")
    canvas.restoreState()


story = []
story.extend(
    [
        Spacer(1, 22 * mm),
        p("PORTFOLIO CONTROL", "eyebrow"),
        p("LagosPM Project Tracker", "title"),
        p("User and operations guide", "h1"),
        Spacer(1, 8 * mm),
        p(
            "A concise guide to signing in, maintaining project records, controlling costs and risks, administering access, and operating the Node.js and SQLite deployment safely.",
            "body",
        ),
        Spacer(1, 8 * mm),
        callout("Start with the Portfolio view for executive status. Use Projects for record-level work, and Admin for users and the immutable audit trail."),
        Spacer(1, 16 * mm),
        table(
            ["AREA", "USE"],
            [
                ["Portfolio", "Status, budget, forecast, risk, and recent activity overview."],
                ["Projects", "Filter, open, register, and update delivery records."],
                ["Pipeline", "Review projects grouped by development phase."],
                ["Costs", "Compare approved budgets, commitments, actuals, and forecasts."],
                ["Risks", "Prioritize exposure by probability × impact and track mitigation."],
                ["Admin", "Manage users and review the dated audit history."],
            ],
            [35 * mm, 130 * mm],
        ),
        Spacer(1, 16 * mm),
        p("Prepared for the Ubuntu / Nginx / systemd deployment package · 04 September 2026", "small"),
        PageBreak(),
    ]
)

story.extend(
    [
        p("01 · ACCESS", "eyebrow"),
        p("Sign in and choose the right role", "h1"),
        section(
            "First sign-in",
            [
                bullet("Enter the user ID or email address supplied by an Admin."),
                bullet("Enter the temporary password. Repeated failed attempts are throttled."),
                bullet("When prompted, replace it with a unique password of at least 12 characters containing upper case, lower case, a number, and a symbol."),
                bullet("The application opens the Portfolio view after the password change succeeds."),
            ],
        ),
        callout("Never share accounts or reuse the bootstrap Admin password. The temporary password must be delivered through an approved secure channel."),
        section(
            "Roles",
            [
                table(
                    ["ROLE", "CAN DO", "CANNOT DO"],
                    [
                        ["Viewer", "Read dashboards, projects, risks, costs, history; export CSV.", "Create or change records; use Admin."],
                        ["Editor", "Viewer access plus create/update projects, development, costs, activity, and risks.", "Manage users or read the Admin audit endpoint."],
                        ["Admin", "All Editor functions plus user access and audit review.", "Bypass audit, CSRF, or password policy."],
                    ],
                    [25 * mm, 72 * mm, 68 * mm],
                )
            ],
        ),
        section(
            "Find anything quickly",
            [
                bullet("Select the search pill in the top bar or press Ctrl+K."),
                bullet("Type a view name, project code, or project name."),
                bullet("Use the arrow keys and Enter to open the selected result; press Escape to close."),
            ],
        ),
        PageBreak(),
    ]
)

story.extend(
    [
        p("02 · PROJECT DELIVERY", "eyebrow"),
        p("Keep the project record current", "h1"),
        section(
            "Register a project",
            [
                bullet("Open Projects and select Add project."),
                bullet("Use a unique project code, choose a portfolio, and enter a descriptive name, phase, status, owner, approved budget, dates, and delivery description."),
                bullet("Save. The project appears in the register and a dated creation entry is written automatically."),
            ],
        ),
        section(
            "Work in the project dialog",
            [
                table(
                    ["TAB", "WHAT TO MAINTAIN"],
                    [
                        ["Overview", "Core status, phase, manager, dates, percent complete, budget, and description."],
                        ["Development", "Planning, design, procurement, construction, next gate, and the full narrative."],
                        ["Costs", "Dated entries for committed, actual, and forecast values."],
                        ["Risks", "Title, context, probability, impact, owner, mitigation, due date, and status."],
                        ["History", "Chronological updates and changes attributed to the signed-in user."],
                    ],
                    [32 * mm, 133 * mm],
                )
            ],
        ),
        section(
            "Safe concurrent editing",
            [
                p("Every project has a version number. If another user saves first, your stale edit is rejected instead of silently replacing their work. Close and reopen the record, review the newer data, then apply your change again.")
            ],
        ),
        section(
            "CSV export",
            [
                p("Select Export CSV in Projects. The export includes codes, portfolio, delivery position, financial totals, dates, description, and last-updated time. It respects your authenticated session and safely quotes commas, line breaks, and quotation marks.")
            ],
        ),
        PageBreak(),
    ]
)

story.extend(
    [
        p("03 · CONTROLS", "eyebrow"),
        p("Costs, risks, and decisions", "h1"),
        section(
            "Cost control",
            [
                bullet("Approved budget is the authorization baseline on the project record."),
                bullet("Committed, actual, and forecast totals are calculated from dated cost entries."),
                bullet("Forecast variance is forecast minus approved budget. A positive value indicates forecast pressure."),
                bullet("Never replace historical entries to hide a change; add the current dated position and explain it in project activity."),
            ],
        ),
        section(
            "Risk control",
            [
                bullet("Probability and impact use a 1–5 scale. Exposure is their product."),
                bullet("Name an accountable owner and write a concrete mitigation, not a status restatement."),
                bullet("Use Open while action is required, Monitoring after the response is implemented, and Closed only when the exposure is no longer active."),
                bullet("High exposures remain visible in the portfolio summary until closed."),
            ],
        ),
        callout("A useful update answers four questions: what changed, why it matters, who owns the next action, and when the next decision is due.", AMBER),
        section(
            "Status language",
            [
                table(
                    ["STATUS", "USE WHEN"],
                    [
                        ["On track", "Delivery is within approved tolerances and no escalation is required."],
                        ["Watch", "A developing issue needs active monitoring but remains recoverable."],
                        ["At risk", "A material delivery, cost, scope, or approval outcome needs intervention."],
                        ["On hold", "Work is intentionally paused by an authorized decision."],
                        ["Complete", "Delivery and required closeout are finished."],
                    ],
                    [34 * mm, 131 * mm],
                )
            ],
        ),
        PageBreak(),
    ]
)

story.extend(
    [
        p("04 · ADMINISTRATION", "eyebrow"),
        p("Users, audit, and security", "h1"),
        section(
            "User lifecycle",
            [
                bullet("Admins create a user with display name, unique ID, email, and the minimum required role."),
                bullet("The generated temporary password is displayed once. Deliver it securely; it cannot be recovered later."),
                bullet("Use Reset password when access is lost. The new temporary password forces another change."),
                bullet("Deactivate accounts promptly when access is no longer required. Do not recycle identities."),
            ],
        ),
        section(
            "Audit trail",
            [
                p("Admin shows dated authentication, project, risk, cost, and user-management events with the responsible account and network address. Audit entries are append-only through the application. Investigate unexpected access, bursts of failed sign-ins, privilege changes, and out-of-hours data changes.")
            ],
        ),
        section(
            "Security model",
            [
                bullet("Passwords are salted and hashed; plaintext passwords are never stored."),
                bullet("Session cookies are HttpOnly, SameSite=Strict, and Secure in production."),
                bullet("State-changing requests require the session CSRF token and a matching origin."),
                bullet("Authorization is checked by the server even when a control is hidden in the interface."),
                bullet("The Node.js service listens only on localhost behind Nginx HTTPS."),
            ],
        ),
        callout("If compromise is suspected: disable the account, preserve audit and Nginx logs, rotate credentials, verify the database and backups, and document the incident before restoring access.", RED),
        PageBreak(),
    ]
)

story.extend(
    [
        p("05 · OPERATIONS", "eyebrow"),
        p("Back up, restore, and release safely", "h1"),
        section(
            "Daily operations",
            [
                bullet("Monitor `lagospm.service`, Nginx, disk space, certificate expiry, backup completion, and failed sign-ins."),
                bullet("Back up with the supplied SQLite online-backup script; it validates the copy before compression."),
                bullet("Copy encrypted backups off-host and perform a documented restore rehearsal."),
            ],
        ),
        section(
            "Release flow",
            [
                bullet("Install each build into a timestamped immutable release directory."),
                bullet("Run the automated tests before switching `/opt/lagospm/current`."),
                bullet("Verify localhost health, HTTPS sign-in, role boundaries, counts, writes, export, and audit."),
                bullet("Keep the prior release and a matching pre-migration database backup until acceptance."),
            ],
        ),
        section(
            "D1 migration gate",
            [
                p("Import into a disposable SQLite target first. Reconcile source and target counts, run foreign-key and integrity checks, and inspect long narratives such as Parks and Resorts. Exact acceptance requires the stated 74 records on both sides; the original source export must be provided before this gate can close.")
            ],
        ),
        section(
            "Support checklist",
            [
                table(
                    ["SYMPTOM", "FIRST CHECK"],
                    [
                        ["Cannot sign in", "User ID/email, active status, temporary-password change, throttling window."],
                        ["Cannot edit", "Role, session expiry, CSRF/origin, and whether the record version is stale."],
                        ["Site unavailable", "Nginx status, service status, localhost health, logs, disk space."],
                        ["Data looks old", "Selected filters, project history, importer counts, database path."],
                        ["Restore needed", "Backup integrity, maintenance window, matching release, post-restore checks."],
                    ],
                    [43 * mm, 122 * mm],
                )
            ],
        ),
        Spacer(1, 10 * mm),
        callout("Detailed commands and procedures are included in the deployment, migration, backup/restore, rollback, security, API, and acceptance documents shipped with the source."),
    ]
)

document = SimpleDocTemplate(
    str(OUTPUT),
    pagesize=A4,
    leftMargin=22 * mm,
    rightMargin=22 * mm,
    topMargin=20 * mm,
    bottomMargin=22 * mm,
    title="LagosPM Project Tracker - User and Operations Guide",
    author="LagosPM",
    subject="User, administration, and operations guidance",
)
document.build(story, onFirstPage=page_decor, onLaterPages=page_decor)
print(OUTPUT)
