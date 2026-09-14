"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { TextAreaField, TextField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { formMessageClass, IDLE_FORM_STATE } from "@/lib/form-state";
import { updateStudent } from "../actions";

export type StudentFormDefaults = {
  name: string;
  studentNo: string | null;
  phone: string | null;
  parentName: string | null;
  parentPhone: string | null;
  dormRoom: string | null;
  internshipUnit: string | null;
  internshipContact: string | null;
  note: string | null;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "保存中…" : "保存"}
    </Button>
  );
}

export function StudentForm({
  studentId,
  defaults,
  dataVersion,
}: {
  studentId: string;
  defaults: StudentFormDefaults;
  /** 传 updatedAt：revalidate 后字段区靠它重挂（代码约定那条老坑） */
  dataVersion: string;
}) {
  const [state, formAction] = useActionState(
    updateStudent.bind(null, studentId),
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="surface space-y-5 p-5">
      <div key={dataVersion} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField name="name" label="姓名" required defaultValue={defaults.name} />
          <TextField name="studentNo" label="学号" defaultValue={defaults.studentNo} />
          <TextField name="dormRoom" label="宿舍" defaultValue={defaults.dormRoom} />
          <TextField name="phone" label="手机" defaultValue={defaults.phone} />
          <TextField name="parentName" label="家长" defaultValue={defaults.parentName} />
          <TextField name="parentPhone" label="家长电话" defaultValue={defaults.parentPhone} />
          <TextField
            name="internshipUnit"
            label="实习单位"
            defaultValue={defaults.internshipUnit}
          />
          <TextField
            name="internshipContact"
            label="驻点联系人"
            defaultValue={defaults.internshipContact}
          />
        </div>
        <TextAreaField
          name="note"
          label="备注"
          rows={3}
          defaultValue={defaults.note}
          hint="只有你自己看得到。写背景，别写判断"
        />
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton />
        {state.message ? (
          <p className={formMessageClass(state.ok)}>{state.message}</p>
        ) : null}
      </div>
    </form>
  );
}
