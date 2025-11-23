import { Link } from "react-router";
import Page from "~/layout/page";

export default function Settings() {
    return (
        <Page>
            <Link to="/settings/github">GitHub</Link>
        </Page>
    );
}
