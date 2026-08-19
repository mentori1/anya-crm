import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-card">
        <span className="brand-mark brand-mark-large">А</span>
        <span className="eyebrow">Защищённое пространство</span>
        <h1>CRM Ани</h1>
        <p>Клиенты, цели, отчёты и расписание доступны только владельцу.</p>
        <LoginForm />
      </section>
    </main>
  );
}
