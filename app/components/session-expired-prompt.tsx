import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Button, Flex } from "@radix-ui/themes";
import { AlertDialog } from "~/components/ScaleAwareThemes";
import {
    isAfdianNativeAvailable,
    probeAfdianSession,
} from "~/api/afdian-account";
import {
    dismissAfdianSessionExpired,
    markAfdianSessionExpired,
    useAfdianSessionExpiredOpen,
} from "~/logic/afdian/login-prompt";
import {
    dismissAstroboxSessionExpired,
    useAstroboxSessionExpiredOpen,
} from "~/logic/account/session-notice";

export default function SessionExpiredPrompt() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const astroboxOpen = useAstroboxSessionExpiredOpen();
    const afdianOpen = useAfdianSessionExpiredOpen();
    const open = astroboxOpen || afdianOpen;

    useEffect(() => {
        if (!isAfdianNativeAvailable()) return;
        let cancelled = false;
        void probeAfdianSession()
            .then((probe) => {
                if (cancelled || !probe.expired) return;
                markAfdianSessionExpired(queryClient);
            })
            .catch(() => {
                // 网络失败不能当成掉登录。
            });
        return () => {
            cancelled = true;
        };
    }, [queryClient]);

    const description = astroboxOpen && afdianOpen
        ? "AstroBox 账号和爱发电账号的登录都已失效，请重新登录。"
        : astroboxOpen
          ? "AstroBox 登录已过期，请重新登录后再继续使用。"
          : "爱发电登录已失效，请重新登录后再查看收入和私信。";

    return (
        <AlertDialog.Root
            open={open}
            onOpenChange={(next) => {
                if (next) return;
                dismissAstroboxSessionExpired();
                dismissAfdianSessionExpired();
            }}
        >
            <AlertDialog.Content maxWidth="420px">
                <AlertDialog.Title>登录已失效</AlertDialog.Title>
                <AlertDialog.Description size="2">
                    {description}
                </AlertDialog.Description>
                <Flex gap="3" mt="4" justify="end" wrap="wrap">
                    <AlertDialog.Cancel>
                        <Button variant="soft" color="gray">
                            稍后
                        </Button>
                    </AlertDialog.Cancel>
                    {afdianOpen && (
                        <Button
                            variant="soft"
                            onClick={() => {
                                dismissAfdianSessionExpired();
                                if (!astroboxOpen) dismissAstroboxSessionExpired();
                                navigate("/settings");
                            }}
                        >
                            登录爱发电
                        </Button>
                    )}
                    {astroboxOpen && (
                        <AlertDialog.Action>
                            <Button
                                onClick={() => {
                                    dismissAstroboxSessionExpired();
                                    dismissAfdianSessionExpired();
                                    navigate("/login");
                                }}
                            >
                                登录 AstroBox
                            </Button>
                        </AlertDialog.Action>
                    )}
                </Flex>
            </AlertDialog.Content>
        </AlertDialog.Root>
    );
}
