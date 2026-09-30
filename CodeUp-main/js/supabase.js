// js/supabase.js
// عميل Supabase واحد يُعاد استخدامه في كل الصفحات (Student + Admin).
// نفس القيم المستخدمة في index.html الحالي — لا تضع Service Role Key هنا أبدًا.

const SUPABASE_URL = "https://hodjfdhapxnygrnzoggr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvZGpmZGhhcHhueWdybnpvZ2dyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MTA1NDMsImV4cCI6MjEwMjk4NjU0M30.aQuyurEpes8valik3A5niy5x7pKZY4M-HhsJQx_DPfg";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});
