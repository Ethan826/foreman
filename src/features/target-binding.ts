// Whether a configuration names the target its state directory is bound
// to (batch review B04). Every bound field is compared, so a copied
// configuration that changes the owner's checkout, the supervisor
// worktree, the project id, the ledger or the attribute allowance is
// refused, each difference listed.
import { Array as Arr, Formatter, Result } from "effect"
import { type TargetBinding, TargetMismatch } from "../domain/target.ts"

/** One bound field: its name and its value as JSON text, so lists compare by content. */
interface BoundField {
  readonly name: string
  readonly value: (target: TargetBinding) => string
}

/** Every bound field, in the order a refusal lists them. */
const boundFields: ReadonlyArray<BoundField> = [
  { name: "projectId", value: (target) => Formatter.formatJson(target.projectId) },
  { name: "ownerCheckout", value: (target) => Formatter.formatJson(target.ownerCheckout) },
  { name: "supervisor.path", value: (target) => Formatter.formatJson(target.supervisor.path) },
  { name: "supervisor.name", value: (target) => Formatter.formatJson(target.supervisor.name) },
  { name: "ledger", value: (target) => Formatter.formatJson(target.ledger) },
  { name: "attributeAllowance", value: (target) => Formatter.formatJson(target.attributeAllowance) },
]

/**
 * Passes when `configured` equals the `recorded` binding in every field;
 * otherwise fails with {@link TargetMismatch} for the binding file at
 * `binding`, listing each field that differs.
 */
export const compareTarget = (
  binding: string,
  recorded: TargetBinding,
  configured: TargetBinding,
): Result.Result<void, TargetMismatch> =>
  Arr.match(Arr.flatMap(boundFields, differenceIn(recorded, configured)), {
    onEmpty: () => Result.void,
    onNonEmpty: (differences) => Result.fail(new TargetMismatch({ binding, differences })),
  })

/** A field's difference, recorded value first, or nothing when the two agree. */
const differenceIn = (recorded: TargetBinding, configured: TargetBinding) => (field: BoundField) =>
  field.value(recorded) === field.value(configured)
    ? []
    : [`${field.name}: recorded ${field.value(recorded)}, configured ${field.value(configured)}`]
