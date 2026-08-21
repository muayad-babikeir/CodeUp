// admin/js/dashboard.js
Admin.sections.dashboard = {
  label: "لوحة التحكم",
  async render(body){
    const isSuper = Admin.role === "super";
    let usersCount, coursesCount, squadsCount, studentsCount, submissionsCount, recent;

    if(isSuper){
      const [{count:u},{count:c},{count:sq},{count:st},{count:sub}] = await Promise.all([
        db.from("profiles").select("id",{count:"exact",head:true}),
        db.from("courses").select("id",{count:"exact",head:true}),
        db.from("squads").select("id",{count:"exact",head:true}),
        db.from("enrollments").select("id",{count:"exact",head:true}),
        db.from("submissions").select("id",{count:"exact",head:true})
      ]);
      usersCount=u; coursesCount=c; squadsCount=sq; studentsCount=st; submissionsCount=sub;
      const {data} = await db.from("activity_log").select("*, profiles(full_name)").order("created_at",{ascending:false}).limit(15);
      recent = data;
    }else{
      const cid = Admin.currentCourseId;
      const [{count:sq},{count:st},{count:sub}] = await Promise.all([
        db.from("squads").select("id",{count:"exact",head:true}).eq("course_id",cid),
        db.from("enrollments").select("id",{count:"exact",head:true}).eq("course_id",cid),
        db.from("submissions").select("id, assignments!inner(course_id)",{count:"exact",head:true}).eq("assignments.course_id",cid)
      ]);
      squadsCount=sq; studentsCount=st; submissionsCount=sub;
      const {data} = await db.from("activity_log").select("*, profiles(full_name)").eq("course_id",cid).order("created_at",{ascending:false}).limit(15);
      recent = data;
    }

    let stats = `<div class="statGrid">`;
    if(isSuper){
      stats += stat("المستخدمون", usersCount);
      stats += stat("الكورسات", coursesCount);
    }
    stats += stat("المجموعات", squadsCount);
    stats += stat("الطلاب", studentsCount);
    stats += stat("التسليمات", submissionsCount);
    stats += `</div>`;

    const activity = (recent||[]).map(a=>`
      <tr><td>${CodeUp.escapeHtml(a.profiles?.full_name||"—")}</td><td>${CodeUp.escapeHtml(a.action_text)}</td><td>${CodeUp.timeAgo(a.created_at)}</td></tr>
    `).join("") || `<tr><td colspan="3" class="emptyState">لا يوجد نشاط بعد.</td></tr>`;

    body.innerHTML = stats + `
      <div class="card"><b>النشاط الأخير</b>
        <table><thead><tr><th>المستخدم</th><th>الحدث</th><th>الوقت</th></tr></thead><tbody>${activity}</tbody></table>
      </div>`;
  }
};

function stat(label, value){
  return `<div class="stat">${label}<b>${value ?? 0}</b></div>`;
}
