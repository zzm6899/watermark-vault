export const escapeEmailHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);

export function emailParagraphs(text: string) {
  return text.split(/\r?\n\s*\r?\n/).filter(Boolean).map(paragraph =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;overflow-wrap:anywhere;">${escapeEmailHtml(paragraph).replace(/\r?\n/g, "<br>")}</p>`
  ).join("");
}

interface ClientEmailOptions {
  title: string;
  body?: string;
  /** Only pass HTML assembled by our own escaped builders. */
  bodyHtml?: string;
  label?: string;
  action?: { label: string; url: string };
  footer?: string;
}

export function buildClientEmail({ title, body = "", bodyHtml, label = "", action, footer = "" }: ClientEmailOptions) {
  let link = "";
  if (action) {
    const url = new URL(action.url);
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid email link");
    link = escapeEmailHtml(url.href);
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escapeEmailHtml(title)}</title>
<style>@media only screen and (max-width:620px){.email-shell{width:100%!important}.email-pad{padding-left:20px!important;padding-right:20px!important}.email-outer{padding:12px!important}}a[x-apple-data-detectors]{color:inherit!important}</style></head>
<body style="margin:0;background:#f3f2ef;color:#252525;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f2ef;"><tr><td class="email-outer" align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="email-shell" data-photoflow-email="true" style="max-width:560px;background:#ffffff;border-top:3px solid #252525;">
<tr><td class="email-pad" style="padding:32px 24px 24px;">
${label ? `<p style="margin:0 0 12px;font-size:11px;letter-spacing:2px;color:#73716c;text-transform:uppercase;">${escapeEmailHtml(label)}</p>` : ""}
<h1 style="margin:0 0 28px;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.2;font-weight:normal;overflow-wrap:anywhere;">${escapeEmailHtml(title)}</h1>
${bodyHtml ?? emailParagraphs(body)}
${action ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:24px;"><tr><td bgcolor="#252525"><a href="${link}" style="display:inline-block;border:1px solid #252525;padding:14px 24px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;">${escapeEmailHtml(action.label)}</a></td></tr></table>` : ""}
</td></tr>
${footer || action ? `<tr><td class="email-pad" style="padding:20px 24px;border-top:1px solid #e8e6e1;font-size:12px;line-height:1.6;color:#73716c;">${escapeEmailHtml(footer)}${footer && action ? "<br>" : ""}${action ? `If the button doesn’t open, <a href="${link}" style="color:#494742;text-decoration:underline;">use this link</a>.` : ""}</td></tr>` : ""}
</table></td></tr></table></body></html>`;
}

export function buildGalleryStatusEmail(album: { title: string; clientName?: string }, galleryUrl: string, stage: "editing" | "delivered", free = false) {
  const greeting = album.clientName ? `Hi ${album.clientName},` : "Hi,";
  return buildClientEmail({
    title: album.title,
    label: stage === "editing" ? "Editing your photos" : "Your finished photos",
    body: `${greeting}\n\n${stage === "editing"
      ? "Your selections are confirmed and editing has started. You’ll receive another email when your finished photos are ready."
      : `Your edited photos are ready in the gallery.${free ? " You can download them at no charge." : " Open the gallery to view your photos and download options."}`}`,
    action: { label: stage === "editing" ? "View gallery" : "View your photos", url: galleryUrl },
  });
}
