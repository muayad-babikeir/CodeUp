import { createClient } from "jsr:@supabase/supabase-js@2";

// نفس نمط CORS المستخدم في delete-account — لازم نرد على OPTIONS صراحة
// وإلا Google Chrome يمنع الطلب قبل وصوله لأي منطق فعلي.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ISSUER_ID = "3388000000023206493";
const CLASS_ID = `${ISSUER_ID}.codeup_membership`;
const CODEUP_URL = "https://codeupsd.online";
const WALLET_API = "https://walletobjects.googleapis.com/walletobjects/v1";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ------------------------------------------------------------
// توقيع JWT (RS256) يدويًا بـ Web Crypto — بدون أي مكتبة خارجية،
// مطلوب مرتين: (أ) للحصول على Google OAuth access token،
// و(ب) لبناء Save-to-Wallet JWT اللي يفتح رابط الإضافة للمستخدم.
// ------------------------------------------------------------
function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const clean = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signJwt(header: object, payload: object, privateKey: CryptoKey): Promise<string> {
  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payload));
  const data = `${encHeader}.${encPayload}`;
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    new TextEncoder().encode(data),
  );
  return `${data}.${base64url(new Uint8Array(sig))}`;
}

// service account -> Google OAuth access token (scope: wallet_object.issuer)
// هذا التوكن يُستخدم فقط داخل السيرفر للاتصال بـ REST API — لا يُرجَّع للعميل أبدًا.
async function getGoogleAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const privateKey = await importPrivateKey(sa.private_key);
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt(
    { alg: "RS256", typ: "JWT" },
    {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/wallet_object.issuer",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    privateKey,
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`,
  });
  const data = await res.json();
  if (!res.ok) throw new Error("google_token_failed: " + JSON.stringify(data));
  return data.access_token as string;
}

// Save-to-Wallet JWT: يشير فقط لـ object موجود بالفعل عند جوجل (id فقط،
// بدون تعريف كامل) — هذا هو الفرق الجوهري عن الطريقة الخاطئة الشائعة
// (الاعتماد على الـJWT وحده لإنشاء الكائن). الإنشاء/التحديث الفعلي
// يحصل دائمًا عبر REST API (googleInsertObject / googlePatchObject) قبل توليد هذا الرابط.
async function buildSaveJwt(objectId: string, sa: { client_email: string; private_key: string }): Promise<string> {
  const privateKey = await importPrivateKey(sa.private_key);
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    { alg: "RS256", typ: "JWT" },
    {
      iss: sa.client_email,
      aud: "google",
      typ: "savetowallet",
      iat: now,
      payload: { genericObjects: [{ id: objectId }] },
    },
    privateKey,
  );
}

function statusLabel(s: string) {
  return ({ active: "نشط", inactive: "غير نشط", suspended: "موقوف" } as Record<string, string>)[s] || s;
}

// يبني تعريف genericObject الكامل من لقطة العضوية الحية (snapshot).
// الوجه الرئيسي مقصود يكون بسيط (header + subheader + QR)، والتفاصيل
// الإضافية (المجموعة/القائد/المشرف/النقاط/الترتيب) تروح في textModulesData
// اللي جوجل تعرضها بقسم "Details" تحت الوجه الرئيسي.
function buildObjectPayload(objectId: string, snap: Record<string, unknown>) {
  const textModules: { id: string; header: string; body: string }[] = [];
  const push = (id: string, header: string, body: unknown) => {
    if (body === null || body === undefined || body === "") return;
    textModules.push({ id, header, body: String(body) });
  };

  push("member_id", "Member ID", snap.member_id);
  push("email", "البريد الإلكتروني", snap.email);
  push("group", "المجموعة", snap.group_name);
  push("leader", "القائد", snap.leader_name);
  push("supervisor", "المشرف", snap.supervisor_name);
  push("points", "النقاط", snap.points ?? 0);
  push("rank", "الترتيب", snap.rank ? `#${snap.rank}` : null);
  push("status", "حالة العضوية", statusLabel(String(snap.membership_status || "")));

  return {
    id: objectId,
    classId: CLASS_ID,
    state: snap.membership_status === "suspended" ? "INACTIVE" : "ACTIVE",
    cardTitle: { defaultValue: { language: "ar", value: "CodeUp" } },
    header: { defaultValue: { language: "ar", value: String(snap.full_name || "عضو CodeUp") } },
    subheader: { defaultValue: { language: "ar", value: "MEMBERSHIP" } },
    hexBackgroundColor: "#0B0C10",
    textModulesData: textModules,
    barcode: {
      type: "QR_CODE",
      value: `${CODEUP_URL}/verify?m=${snap.member_id}`,
      alternateText: String(snap.member_id || ""),
    },
    hasUsers: true,
  };
}

async function googleGetObject(objectId: string, token: string) {
  const res = await fetch(`${WALLET_API}/genericObject/${objectId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  const data = await res.json();
  if (!res.ok) throw new Error("google_get_failed: " + JSON.stringify(data));
  return data;
}

async function googleInsertObject(payload: unknown, token: string) {
  const res = await fetch(`${WALLET_API}/genericObject`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("google_insert_failed: " + JSON.stringify(data));
  return data;
}

async function googlePatchObject(objectId: string, payload: unknown, token: string) {
  const res = await fetch(`${WALLET_API}/genericObject/${objectId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("google_patch_failed: " + JSON.stringify(data));
  return data;
}

// ------------------------------------------------------------
// المعالج الرئيسي
// action:
//   "get_or_create" (افتراضي) — يُستخدم من زر الطالب. لو البطاقة
//   موجودة وما تغيّر شيء، يرجّع رابط الإضافة مباشرة بدون أي نداء لجوجل.
//   "sync" — يفرض إعادة حساب اللقطة وPatch حتى لو ما تغيّر شيء
//   (زر "مزامنة" في الأدمن).
// ------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return jsonResponse({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const saJson = Deno.env.get("GOOGLE_WALLET_SERVICE_ACCOUNT");
    if (!saJson) return jsonResponse({ error: "missing_service_account_secret" }, 500);
    const sa = JSON.parse(saJson);

    // هوية المستخدم تُستخرج من الـJWT نفسه عبر Supabase Auth — لا نثق
    // بأي user_id قادم من body الطلب.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !userData?.user) return jsonResponse({ error: "invalid_session" }, 401);
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const action = body?.action === "sync" ? "sync" : "get_or_create";

    // مزامنة بطاقة عضو آخر (زر "مزامنة" بلوحة الأدمن) — مسموح فقط
    // لسوبر أدمن، ويُتحقق منه من قاعدة البيانات نفسها (مش من أي flag
    // يُرسله العميل)، مش من نفس المستخدم صاحب الجلسة.
    let targetUserId = userId;
    if (body?.target_user_id && body.target_user_id !== userId) {
      const { data: callerProfile } = await admin
        .from("profiles").select("is_super_admin").eq("id", userId).maybeSingle();
      if (!callerProfile?.is_super_admin) return jsonResponse({ error: "forbidden" }, 403);
      targetUserId = body.target_user_id;
    }

    // 1) العضوية (لازم تكون موجودة — الـtrigger ينشئها تلقائيًا لكل حساب)
    const { data: membership, error: mErr } = await admin
      .from("memberships")
      .select("id, member_id, status")
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (mErr || !membership) return jsonResponse({ error: "membership_not_found" }, 404);

    // 2) لقطة حية من enrollments/squads/course_admins — بدون بيانات مكررة
    const { data: snapshot, error: snapErr } = await admin.rpc("get_membership_snapshot", {
      p_user_id: targetUserId,
    });
    if (snapErr) return jsonResponse({ error: "snapshot_failed", detail: snapErr.message }, 500);

    const objectId = `${ISSUER_ID}.${membership.member_id}`;

    // 3) صف البطاقة — ننشئه لو أول مرة (status=syncing يمنع سباق ضغطات متكررة)
    let { data: pass } = await admin
      .from("membership_wallet_passes")
      .select("*")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!pass) {
      const { data: created, error: insErr } = await admin
        .from("membership_wallet_passes")
        .insert({
          user_id: targetUserId,
          membership_id: membership.id,
          object_id: objectId,
          status: "syncing",
          sync_status: "pending",
        })
        .select()
        .single();
      if (insErr) {
        // سباق محتمل: طلب متزامن آخر أنشأ الصف قبلنا بالضبط — اقرأه بدل الفشل
        const { data: existing } = await admin
          .from("membership_wallet_passes")
          .select("*")
          .eq("user_id", targetUserId)
          .single();
        pass = existing;
      } else {
        pass = created;
      }
    }
    if (!pass) return jsonResponse({ error: "wallet_pass_init_failed" }, 500);

    const snapshotChanged = JSON.stringify(pass.snapshot || {}) !== JSON.stringify(snapshot);

    // مسار سريع: البطاقة نشطة وما تغيّر شيء ومفيش طلب مزامنة إجبارية
    // → رابط الإضافة مباشرة بدون أي اتصال بجوجل.
    if (action === "get_or_create" && pass.status === "active" && !snapshotChanged) {
      const saveJwt = await buildSaveJwt(pass.object_id, sa);
      return jsonResponse({
        add_to_wallet_url: `https://pay.google.com/gp/v/save/${saveJwt}`,
        status: pass.status,
        member_id: membership.member_id,
      });
    }

    // إنشاء/تحديث فعلي عند Google Wallet
    const token = await getGoogleAccessToken(sa);
    const payload = buildObjectPayload(pass.object_id, snapshot);

    try {
      const existing = await googleGetObject(pass.object_id, token);
      if (existing) {
        await googlePatchObject(pass.object_id, payload, token);
      } else {
        await googleInsertObject(payload, token);
      }

      await admin
        .from("membership_wallet_passes")
        .update({
          status: "active",
          sync_status: "synced",
          last_synced_at: new Date().toISOString(),
          last_error: null,
          snapshot,
          updated_at: new Date().toISOString(),
        })
        .eq("id", pass.id);

      const saveJwt = await buildSaveJwt(pass.object_id, sa);
      return jsonResponse({
        add_to_wallet_url: `https://pay.google.com/gp/v/save/${saveJwt}`,
        status: "active",
        member_id: membership.member_id,
      });
    } catch (googleErr) {
      await admin
        .from("membership_wallet_passes")
        .update({
          status: "sync_failed",
          sync_status: "failed",
          last_error: String((googleErr as Error)?.message || googleErr).slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", pass.id);
      return jsonResponse({ error: "google_wallet_failed" }, 502);
    }
  } catch (e) {
    return jsonResponse({ error: String((e as Error)?.message || e) }, 500);
  }
});
