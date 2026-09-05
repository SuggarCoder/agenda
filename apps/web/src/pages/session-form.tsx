import { sessionSchema } from '@agenda/shared';
import { FormDialog, useFeedback } from '../ui';
import type { Lookup, Session } from '../types';
import { dateKey, inputToISO, localInput, send } from '../api';
export function SessionForm(props: {
  classes: Lookup[];
  classId?: string;
  session?: Session;
  onClose: () => void;
  onSaved: () => unknown;
}) {
  const feedback = useFeedback();
  const tomorrow = dateKey(new Date(Date.now() + 86400000));
  return (
    <FormDialog
      title={props.session ? '编辑考勤时段' : '新建考勤时段'}
      description="时间均为北京时间。名单按上课开始时的有效分班确定；下课后才可处理考勤。"
      initial={{
        class_id: props.session?.class_id ?? props.classId ?? '',
        starts_at: props.session ? localInput(props.session.starts_at) : `${tomorrow}T09:00`,
        ends_at: props.session ? localInput(props.session.ends_at) : `${tomorrow}T10:00`,
      }}
      fields={[
        {
          key: 'class_id',
          label: '所属班级',
          type: 'select',
          options: props.classes
            .filter((c) => !c.archived_at || c.id === props.session?.class_id)
            .map((c) => ({ value: c.id, label: c.name })),
        },
        { key: 'starts_at', label: '开始时间', type: 'datetime-local' },
        { key: 'ends_at', label: '结束时间', type: 'datetime-local' },
      ]}
      onClose={props.onClose}
      onSave={async (values) => {
        const body = sessionSchema.parse({
          class_id: values.class_id,
          starts_at: inputToISO(values.starts_at),
          ends_at: inputToISO(values.ends_at),
        });
        await send(
          `/attendance-sessions${props.session ? `/${props.session.id}` : ''}`,
          props.session ? 'PATCH' : 'POST',
          body,
        );
        await props.onSaved();
        feedback.toast(props.session ? '时段已更新' : '考勤时段已创建');
      }}
    />
  );
}
