# API 契约

接口统一使用 `/api` 前缀。ID 为 UUID；时间返回 ISO 8601，起止时间输入必须包含时区偏移。页面输入解释为北京时间，数据库使用 `timestamptz`。

写操作需带 JSON Content-Type、会话 Cookie 和与 `APP_ORIGIN` 一致的 Origin。登录不需已有 Cookie；健康检查公开。每次请求从 PostgreSQL 读取当前账号状态和角色。

## 认证

| 方法与路径            | 请求                           | 结果                                        |
| --------------------- | ------------------------------ | ------------------------------------------- |
| `POST /auth/login`    | `username, password`           | `{ user }`，设置 HttpOnly 会话 Cookie       |
| `GET /auth/me`        | 无                             | `{ user }`，含角色和 `must_change_password` |
| `POST /auth/password` | `currentPassword, newPassword` | 保存新密码并撤销所有旧会话，需重新登录      |
| `POST /auth/logout`   | 无                             | 撤销当前会话并清除 Cookie                   |
| `GET /health`         | 无                             | 数据库可连接时返回 `{ ok: true }`           |

新密码 8–128 个字符，不得与原密码相同。首次改密前仅允许当前账号查询、改密和退出。登录限流按账号每 15 分钟 10 次、请求 IP 每 15 分钟 100 次计算；成功登录清除该账号计数。

## 基础资料

基础资料写操作仅管理员可用；读操作按班级权限过滤，教师账号列表仅管理员可见。

| 资源       | 字段                                                                                 |
| ---------- | ------------------------------------------------------------------------------------ |
| `campuses` | `name`                                                                               |
| `courses`  | `name`                                                                               |
| `students` | `name, phone, guardian_name, guardian_relation`；关系为 `father / mother / relative` |
| `classes`  | `name, campus_id, course_id`                                                         |
| `users`    | 创建：`username, name, phone, role`；角色为 `homeroom_teacher / subject_teacher`     |

- `GET /{resource}`：分页查询。
- `POST /{resource}`：创建并返回记录，状态码 201。教师初始密码由服务端固定，不接受客户端指定。
- `PATCH /{resource}/:id`：更新完整可编辑字段。教师可编辑字段仅为 `name, phone, active`。
- `POST /{resource}/:id/archive`：归档校区、课程、学员或班级。账号使用 PATCH 禁用。
- `POST /users/:id/reset-password`：重置教师密码，要求下次改密并撤销其现有会话。
- `GET /lookups`：返回权限范围内的校区、课程、班级、学员和教师选项；保留归档标记以支持历史查询。管理员获得全部教师选项，教师仅获得其可见班级当前关联教师的 `id, name, role, active`。

## 班级关系

| 方法与路径                                             | 请求／结果                                            |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `GET /classes/:id`                                     | 班级详情，包含教师及分班历史                          |
| `PUT /classes/:id/teachers`                            | `{ role, user_id }`；`user_id: null` 取消对应角色分配 |
| `POST /classes/:id/enrollments`                        | `{ student_id }`，入班时间由数据库生成                |
| `POST /classes/:id/enrollments/:enrollmentId/withdraw` | 结束当前分班，重复退出返回成功                        |

## 考勤

- `GET /attendance-sessions`：查询时段、应到及录入人数、数据库时间 `server_now`、是否可处理 `can_process` 和派生状态 `state`。
- `POST /attendance-sessions`：管理员创建，输入 `class_id, starts_at, ends_at`。
- `PATCH /attendance-sessions/:id`：管理员修改相同字段；已有考勤后锁定时间与所属班级。
- `DELETE /attendance-sessions/:id`：管理员删除尚无考勤的时段。
- `GET /attendance-sessions/:id/attendance`：返回 `{ session, students }`。未结束返回 409；无班级权限返回 404。
- `PUT /attendance-sessions/:id/records/:studentId`：逐人保存，示例：

```json
{ "status": "present", "expected_version": 0 }
```

首次录入提交版本 0。成功返回完整考勤记录，包含版本、首次和最后操作者。更正时提交上次读取的版本；成功后版本递增。相同版本提交相同状态直接返回原记录。旧版本返回 409，客户端需重新读取名单。

不接受客户端提供的 `actor_id`、`created_by`、`updated_by`、班级或时间区间，避免越权或篡改审计归属。

## 报表与审计

| 方法与路径                             | 返回                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /reports/attendance`              | 汇总 `summary`、按班级分组 `groups`、按教师及角色分组 `teachers`、分页明细 `items` |
| `GET /reports/attendance.csv`          | 当前筛选范围内全部逐人明细，UTF-8 BOM CSV                                          |
| `GET /reports/attendance/teachers.csv` | 当前筛选范围内全部教师汇总，UTF-8 BOM CSV                                          |
| `GET /weekly-warnings`                 | 当前自然周边界、服务器时间及分页预警名单                                           |
| `GET /weekly-warnings.csv`             | 当前范围的周预警名单                                                               |
| `GET /audit-logs`                      | 权限范围内的只读分页审计记录                                                       |
| `GET /dashboard`                       | 在读学员、班级、待处理时段、周预警、近 7 日走势和最近考勤动态                      |

报表指标：`expected, present, absent, unrecorded, students, sessions, attendance_rate, recording_rate`。`attendance_rate` 为实到／应到，`recording_rate` 为（实到 + 缺勤）／应到；两者是保留一位小数的百分比数值，应到为零时为 `null`。CSV 复用数据权限，并对电子表格公式开头的文本进行转义。

`teachers` 每行额外包含 `teacher_id, teacher_name, teacher_role, classes`，分别为教师 ID、姓名、班级分配角色和有应到记录的班级数；汇总不受明细分页影响。教师归属使用当前 `class_teachers` 分配，与考勤录入人无关，换老师后历史记录归属现任老师；仅返回筛选范围内有应到记录的分组。学员跨班去重，同班可分别计入班主任和任课老师，教师行相加不等于全局总计。没有分配教师的班级仍计入不限定教师的全局汇总。所有教师分组只包含当前账号有权查看的班级。

明细及明细 CSV 包含当前班主任和任课老师姓名（`homeroom_name, subject_name`）。两种 CSV 均按相同筛选导出全部记录，不受 `page, page_size` 影响。

列表返回格式：

```json
{ "items": [], "total": 0, "page": 1, "page_size": 20 }
```

查询参数：

- `page` 默认 1，`page_size` 默认 20、最大 100。
- `q`：搜索词，最长 100 字符。
- `campus_id, course_id, class_id`：班级、时段、报表、周预警和审计范围筛选；省略校区表示全部可见校区。
- `from, to`：北京时间日期 `YYYY-MM-DD`，包含所选日期全天；考勤按时段开始时间筛选，审计按操作时间筛选。周预警固定当前周，不使用日期范围。
- `student_id`：报表及审计筛选；`actor_id`：审计操作者筛选。
- `teacher_id, teacher_role`：仅用于考勤报表及其两种 CSV；按同一条当前班级教师关联匹配。角色为 `homeroom_teacher / subject_teacher`，可独立筛选角色或指定教师，并与日期、校区、课程、班级、学员和搜索条件取交集。
- `state`：时段筛选，`upcoming / pending / partial / complete / todo`；`todo` 表示待录入与部分录入的合并视图。
- `include_archived=true`：基础资料列表包含已归档记录。

## 错误

```json
{
  "error": {
    "code": "ATTENDANCE_VERSION_CONFLICT",
    "message": "考勤已被其他人修改，请刷新名单后重新操作"
  }
}
```

| 状态码 | 主要错误码                                                | 含义                                         |
| ------ | --------------------------------------------------------- | -------------------------------------------- |
| 400    | `VALIDATION_ERROR`                                        | 字段或日期无效，可能含 `details` 字段错误    |
| 401    | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`                  | 会话失效或登录失败                           |
| 403    | `FORBIDDEN`, `INVALID_ORIGIN`, `PASSWORD_CHANGE_REQUIRED` | 无权限、来源校验失败或需要首次改密           |
| 404    | `NOT_FOUND`                                               | 记录不存在或无权访问该班级                   |
| 409    | `SESSION_NOT_ENDED`                                       | 尚未下课                                     |
| 409    | `SESSION_LOCKED`, `CLASS_HISTORY_LOCKED`                  | 修改会破坏已有考勤或排课历史                 |
| 409    | `ATTENDANCE_TIME_CONFLICT`                                | 与另一班级出勤时段重叠，不暴露无权限班级详情 |
| 409    | `ATTENDANCE_VERSION_CONFLICT`, `CONCURRENT_CHANGE`        | 已被他人修改，应刷新核实                     |
| 409    | `STUDENT_NOT_ENROLLED`, `ENROLLMENT_OVERLAP`              | 不在历史名单中，或重复分班                   |
| 409    | `ARCHIVED`, `ACTIVE_CLASSES`, `UPCOMING_SESSIONS`         | 归档对象或其关联状态不允许当前操作           |
| 429    | `LOGIN_RATE_LIMITED`                                      | 登录尝试过多                                 |
| 500    | `INTERNAL_ERROR`                                          | 未处理服务端错误；数据库内部细节不返回客户端 |
