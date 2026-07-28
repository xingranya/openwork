type JsonRecord = Record<string, unknown>;

export type ConfigurableLlmModel = {
  id: string;
  name: string;
  config: JsonRecord;
};

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

/**
 * 把管理员选择的图片输入能力写入最终模型配置。
 * 未提交选择字段表示旧客户端请求，此时不得改写已有模型能力。
 */
export function applyModelImageInputCapabilities<T extends ConfigurableLlmModel>(
  models: T[],
  imageInputModelIds: string[] | undefined,
): T[] {
  if (imageInputModelIds === undefined) {
    return models;
  }

  const enabledModelIds = new Set(
    imageInputModelIds.map((modelId) => modelId.trim()).filter(Boolean),
  );
  return models.map((model) => {
    const supportsImageInput = enabledModelIds.has(model.id);
    const currentModalities = model.config.modalities;
    const modalities = typeof currentModalities === "object" && currentModalities !== null && !Array.isArray(currentModalities)
      ? currentModalities as JsonRecord
      : {};
    const currentInput = stringList(modalities.input).filter((entry) => entry !== "image");
    const input = [...new Set(["text", ...currentInput, ...(supportsImageInput ? ["image"] : [])])];
    const currentOutput = stringList(modalities.output);

    return {
      ...model,
      config: {
        ...model.config,
        attachment: supportsImageInput,
        modalities: {
          ...modalities,
          input,
          output: currentOutput.length > 0 ? currentOutput : ["text"],
        },
      },
    };
  });
}
