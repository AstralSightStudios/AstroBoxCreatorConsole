import Header from "~/components/header";

export default function Page({ children }: React.PropsWithChildren) {
    return (
        <div className="flex flex-col p-2">
            <Header></Header>
            {children}
        </div>
    );
}
