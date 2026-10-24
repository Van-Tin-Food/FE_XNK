import SignUpForm from "@/components/auth/SignUpForm";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "SignUp Page | VTF - Operations",
  description: "This is  SignUp Page VTF Operations",
  // other metadata
};

export default function SignUp() {
  return <SignUpForm />;
}
