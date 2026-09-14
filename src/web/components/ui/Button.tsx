import {forwardRef,type ButtonHTMLAttributes,Children,isValidElement} from "react";
import {InteractiveHoverButton} from "./interactive-hover-button";
export const Button=forwardRef<HTMLButtonElement,ButtonHTMLAttributes<HTMLButtonElement>>(function Button({className="",children,...props},ref){
 const iconOnly=!!props["aria-label"] && Children.toArray(children).every(child=>isValidElement(child) && typeof child.type!=="string");
 return iconOnly ? <button ref={ref} className={"button "+className} {...props}>{children}</button> : <InteractiveHoverButton ref={ref} className={"button "+className} {...props}>{children}</InteractiveHoverButton>;
});
