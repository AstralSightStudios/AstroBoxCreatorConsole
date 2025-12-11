import { Flex, Radio, Text, TextField } from "@radix-ui/themes";
import Page from "~/layout/page";

export function NewResourcePublishPage() {
  return (
      <Page>
          <div className="flex flex-col pt-1.5 px-3.5 gap-2.5">
              <InputField label="资源ID" placeholder="快应用请输入包名，表盘请留空"></InputField>
              <InputField label="资源名称" placeholder="请输入资源名称"></InputField>
              <InputField label="资源简介" placeholder="用几句话介绍你的资源"></InputField>
              <div className="flex flex-col gap-1.5">
                  <p>资源类型</p>
                  <div className="flex flex-row gap-4">
                 	<Flex asChild gap="2">
                  		<Text as="label" size="2">
                 			<Radio name="resourceType" value="quick_app" defaultChecked />
                 			快应用
                  		</Text>
                   	</Flex>
                   	<Flex asChild gap="2">
                  		<Text as="label" size="2">
                 			<Radio name="resourceType" value="watch_face" />
                 			表盘
                  		</Text>
                   	</Flex>
                  </div>
              </div>
          </div>
      </Page>
  );
}

function InputField({ label, placeholder }: { label: string, placeholder: string }) {
    return (
        <div className="flex flex-col gap-1.5">
            <p>{label}</p>
            <TextField.Root className="max-w-2xl" placeholder={placeholder}></TextField.Root>
        </div>
    );
}
