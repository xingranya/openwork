/** @jsxImportSource react */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 远程 Worker 连接失败时显示兼容性说明，并引导员工联系公司管理员。
 */
export function OpenWorkDenHelpLink() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="mt-2 inline-flex items-center text-[11px] font-medium text-blue-11 underline-offset-2 hover:underline"
        onClick={() => setOpen(true)}
      >
        远程 Worker 无法连接？查看处理方法
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>远程 Worker 兼容说明</DialogTitle>
            <DialogDescription>
              如果远程 Worker 创建于公司服务器升级之前，它可能与当前 SeeWayWork 版本不兼容。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-[13px] leading-5 text-gray-11">
            <p>请按以下顺序处理：</p>
            <ul className="ml-4 list-disc space-y-2">
              <li>
                确认 SeeWayWork 与公司 Den、远程 Worker 使用兼容版本。
              </li>
              <li>
                如果仍无法连接，请联系公司管理员升级或重新创建此 Worker。
              </li>
            </ul>
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              关闭
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
