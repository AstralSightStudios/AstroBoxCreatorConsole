import { sendApiRequest } from "./request";

export interface CommentMedal {
  id: string;
  name: string;
  icon: string;
  background: string;
  foreground: string;
}

export interface CommentView {
  id: string;
  resourceId: string;
  senderId: string;
  senderDisplayName?: string;
  senderAvatar?: string;
  senderMedals?: CommentMedal[];
  content: string;
  timestamp: string;
  likes: number;
  liked: boolean;
  senderLocation?: string;
  parentId: string | null;
  replyTo?: string;
  isDeveloperReply?: boolean;
  childrenTotal?: number;
  childrenPage?: number;
  childrenPageSize?: number;
  children: CommentView[];
}

export const CommunityApi = {
  comment: {
    detail: (body: { commentId: string; page?: number; pageSize?: number }) =>
      sendApiRequest<CommentView>("/comment/detail", "POST", undefined, body),
  },
};
