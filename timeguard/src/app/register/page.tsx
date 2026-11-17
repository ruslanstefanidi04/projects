import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/shared/lib/auth";
import { RegisterForm } from "@/widgets/auth/register-form";
import Link from "next/link";

export default async function RegisterPage() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/day");

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12">
      <Link
        href="/"
        className="font-display tracking-[0.2em] text-sm mb-10 text-muted hover:text-ink"
      >
        TIMEGUARD
      </Link>
      <div className="w-full max-w-sm rounded-2xl border border-edge bg-panel/80 p-6 shadow-soft">
        <RegisterForm />
      </div>
    </div>
  );
}
