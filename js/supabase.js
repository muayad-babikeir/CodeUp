// js/supabase.js
// عميل Supabase واحد يُعاد استخدامه في كل الصفحات (Student + Admin).
// نفس القيم المستخدمة في index.html الحالي — لا تضع Service Role Key هنا أبدًا.

const SUPABASE_URL = "https://jhnsklqqyotjmgobqfiv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpobnNrbHFxeW90am1nb2JxZml2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMzAwNDIsImV4cCI6MjEwMjgwNjA0Mn0.5aauGN_SDl1OuOw_LNtcOhFbbgKtaPlmTky4Vo9yGAA";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});
