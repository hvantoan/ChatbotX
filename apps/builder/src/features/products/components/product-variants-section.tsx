"use client"

import { InputField } from "@inboxos.io/ui/components/form/input-field"
import { InputNumberField } from "@inboxos.io/ui/components/form/input-number-field"
import { Button } from "@inboxos.io/ui/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@inboxos.io/ui/components/ui/card"
import { Checkbox } from "@inboxos.io/ui/components/ui/checkbox"
import { TagsInputField } from "@inboxos.io/ui/components/ui/muhammada86/tags-input-field"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@inboxos.io/ui/components/ui/table"
import { PlusIcon, TrashIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect } from "react"
import {
  Controller,
  useFieldArray,
  useFormContext,
  useWatch,
} from "react-hook-form"
import { PRICE_INPUT_PROPS } from "../constants"
import type { ProductFormRequest } from "../schema/action"

function computeCartesianProduct(
  options: Array<{ name: string; values: string[] }>,
): Record<string, string>[] {
  const validOptions = options.filter(
    (option) => option.name && option.values.length > 0,
  )
  if (validOptions.length === 0) {
    return []
  }

  return validOptions.reduce<Record<string, string>[]>(
    (accumulator, option) => {
      if (accumulator.length === 0) {
        return option.values.map((value) => ({ [option.name]: value }))
      }
      return accumulator.flatMap((existing) =>
        option.values.map((value) => ({ ...existing, [option.name]: value })),
      )
    },
    [],
  )
}

function buildVariantLabel(combination: Record<string, unknown>): string {
  return Object.values(combination).join(" / ")
}

export function ProductVariantsSection() {
  const t = useTranslations("products")
  const tActions = useTranslations("actions")
  const { control, setValue } = useFormContext<ProductFormRequest>()

  const {
    fields: optionFields,
    append: appendOption,
    remove: removeOption,
  } = useFieldArray({
    control,
    name: "variantOptions",
  })

  const variantOptions = useWatch({ control, name: "variantOptions" }) ?? []
  const variants = useWatch({ control, name: "variants" }) ?? []

  const optionsKey = JSON.stringify(
    variantOptions.map((o) => ({ name: o.name, values: o.values })),
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: ignore
  useEffect(() => {
    const combinations = computeCartesianProduct(variantOptions)

    const currentVariants = variants
    const updatedVariants = combinations.map((combination) => {
      const label = buildVariantLabel(combination)
      const existing = currentVariants.find(
        (variant) => buildVariantLabel(variant.combination) === label,
      )
      return {
        combination,
        price: existing?.price ?? 0,
        isEnabled: existing?.isEnabled ?? true,
      }
    })

    setValue("variants", updatedVariants, { shouldDirty: false })
  }, [optionsKey, setValue])

  function addOption() {
    appendOption({ name: "", values: [], position: optionFields.length })
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("sections.variants")}</CardTitle>
        <CardDescription className="text-xs">
          {t("fields.variantsDescription")}
        </CardDescription>
        <CardAction>
          <Button onClick={addOption} size="sm" type="button" variant="outline">
            <PlusIcon className="size-3" />
            {tActions("add")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {optionFields.length > 0 && (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 font-medium text-muted-foreground text-xs">
              <span className="font-semibold text-sm">
                {t("fields.optionName.label")}
              </span>
              <span className="font-semibold text-sm">
                {t("fields.optionValue.label")}
              </span>
              <span className="w-9" />
            </div>

            {optionFields.map((field, index) => (
              <div
                className="grid grid-cols-[1fr_1fr_auto] items-start gap-2"
                key={field.id}
              >
                <InputField
                  name={`variantOptions.${index}.name`}
                  placeholder={t("fields.optionName.label")}
                />

                <TagsInputField
                  addAnotherPlaceholder={tActions("addAnother")}
                  className="[&>label+div]:mt-0 [&>label]:hidden"
                  name={`variantOptions.${index}.values`}
                  placeholder={t("fields.optionValue.label")}
                  tagVariant="secondary"
                  variant="default"
                />

                <Button
                  onClick={() => removeOption(index)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <TrashIcon className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {variants.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-8 p-2" />
                  <TableHead className="p-2">
                    {t("fields.variant.label")}
                  </TableHead>
                  <TableHead className="p-2">
                    {t("fields.price.label")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variants.map((variant, index) => (
                  <TableRow key={buildVariantLabel(variant.combination)}>
                    <TableCell className="p-2">
                      <Controller
                        control={control}
                        name={`variants.${index}.isEnabled`}
                        render={({ field: checkboxField }) => (
                          <Checkbox
                            checked={checkboxField.value}
                            onCheckedChange={checkboxField.onChange}
                          />
                        )}
                      />
                    </TableCell>
                    <TableCell className="whitespace-normal p-2">
                      {buildVariantLabel(variant.combination)}
                    </TableCell>
                    <TableCell className="p-2">
                      <InputNumberField
                        {...PRICE_INPUT_PROPS}
                        min={0}
                        name={`variants.${index}.price`}
                        placeholder="0"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
