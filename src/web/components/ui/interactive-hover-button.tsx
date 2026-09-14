import React from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
export interface InteractiveHoverButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {text?:string;}
const InteractiveHoverButton=React.forwardRef<HTMLButtonElement,InteractiveHoverButtonProps>(({text="Button",children,className,...props},ref)=>{
 const label=children ?? text;
 return <button ref={ref} className={cn("interactive-hover-button group relative cursor-pointer overflow-hidden rounded-full border bg-background text-center font-semibold",className)} {...props}>
   <span className="hover-button-label">{label}</span>
   <span className="hover-button-reveal" aria-hidden="true">{label}<ArrowRight size={16}/></span>
   <span className="hover-button-fill" aria-hidden="true"/>
 </button>;
});
InteractiveHoverButton.displayName="InteractiveHoverButton";
export {InteractiveHoverButton};
