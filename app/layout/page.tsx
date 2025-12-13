export default function Page({ children }: React.PropsWithChildren) {
    return (
        <div className="flex flex-col">
            {children}
        </div>
    );
}
