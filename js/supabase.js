// js/supabase.js
// عميل Supabase واحد يُعاد استخدامه في كل الصفحات (Student + Admin).
// نفس القيم المستخدمة في index.html الحالي — لا تضع Service Role Key هنا أبدًا.

const SUPABASE_URL = "https://btzjzwdurdueibgbdesb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0emp6d2R1cmR1ZWliZ2JkZXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMTE2MDMsImV4cCI6MjEwMjg4NzYwM30.TOQ29WDZ93gyUKHMr9OxKtbEkOLkLxtWtS3-lWsp5Og";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});
