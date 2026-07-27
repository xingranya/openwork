/** @jsxImportSource react */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";
import { TextInput } from "../../../design-system/text-input";
import {
  displayCustomControlPlaneUrl,
  formatControlPlaneHost,
  isValidControlPlaneUrl,
} from "./control-plane-url";

type OrganizationServerAffordanceProps = {
  busy: boolean;
  error: string | null;
  onSave: (url: string) => Promise<boolean>;
  required?: boolean;
  url: string;
};

export function OrganizationServerAffordance(props: OrganizationServerAffordanceProps) {
  const configuredUrl = isValidControlPlaneUrl(props.url) ? props.url : "";
  const customUrl = displayCustomControlPlaneUrl(props.url);
  const visibleUrl = props.required ? configuredUrl : customUrl;
  const hasServer = Boolean(visibleUrl);
  const [open, setOpen] = useState(() => props.required === true && !hasServer);
  const [draft, setDraft] = useState("");
  const connectedHost = visibleUrl ? formatControlPlaneHost(visibleUrl) : "";

  useEffect(() => {
    if (open) setDraft(visibleUrl);
  }, [open, visibleUrl]);

  useEffect(() => {
    if (props.required && !hasServer) setOpen(true);
  }, [hasServer, props.required]);

  const submit = async () => {
    const ok = await props.onSave(draft);
    if (ok) setOpen(false);
  };

  return (
    <div className="flex justify-center">
      {hasServer ? (
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-center text-sm text-muted-foreground">
          <span>{t("welcome.organization_server_connected", { host: connectedHost })}</span>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-sm"
            onClick={() => setOpen(true)}
          >
            {t("welcome.organization_server_change")}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-sm text-muted-foreground"
          onClick={() => setOpen(true)}
        >
          {t("welcome.organization_server_link")}
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && props.required && !hasServer) return;
          setOpen(nextOpen);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("welcome.organization_server_dialog_title")}</DialogTitle>
            <DialogDescription>{t("welcome.organization_server_dialog_desc")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <TextInput
              label={t("welcome.organization_server_url_label")}
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              placeholder={t("welcome.organization_server_url_placeholder")}
              disabled={props.busy}
            />
            {props.error ? (
              <p className="text-xs text-destructive">{props.error}</p>
            ) : null}
          </div>

          <DialogFooter>
            {props.required && !hasServer ? null : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={props.busy}
              >
                {t("common.cancel")}
              </Button>
            )}
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={props.busy || !isValidControlPlaneUrl(draft)}
            >
              {props.required && !hasServer ? "连接并继续" : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
