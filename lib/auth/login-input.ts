import { loginSchema } from "@/lib/validations";

export function parseLoginFormData(formData: FormData) {
  return loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
}
