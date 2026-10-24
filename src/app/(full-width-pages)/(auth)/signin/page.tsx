import SignInForm from "@/components/auth/SignInForm";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "SignIn Page | VTF Operations",
  description: "This is SignIn Page VTF Operations",
};

export default function SignIn() {
  return <SignInForm />;
}
