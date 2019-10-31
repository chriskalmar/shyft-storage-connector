import './setupAndTearDown';
import { find } from './db';

import { asAdmin, removeListDynamicData } from './testUtils';

import { Profile } from './models/Profile';
import { Board } from './models/Board';
import { BoardMemberView } from './models/BoardMemberView';

const orderByBoardIdAndInviterIdAsc = {
  orderBy: [
    {
      attribute: 'boardId',
      direction: 'ASC',
    },
    {
      attribute: 'inviterId',
      direction: 'ASC',
    },
  ],
};

const orderByBoardIdAndInviterIdDesc = {
  orderBy: [
    {
      attribute: 'boardId',
      direction: 'DESC',
    },
    {
      attribute: 'inviterId',
      direction: 'DESC',
    },
  ],
};

describe('view list', () => {
  it('orderBy', async () => {
    const invites = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdAsc },
      asAdmin(),
    );

    expect(invites).toMatchSnapshot();
  });

  it('orderBy + first', async () => {
    const invites = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdAsc, first: 3 },
      asAdmin(),
    );

    expect(invites).toMatchSnapshot();
  });

  it('orderBy + first 0', async () => {
    const invites = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdAsc, first: 0 },
      asAdmin(),
    );

    expect(invites).toMatchSnapshot();
  });

  it('orderBy + last', async () => {
    const invites = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdAsc, last: 3 },
      asAdmin(),
    );

    expect(invites).toMatchSnapshot();
  });

  it('descending orderBy', async () => {
    const invites = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdDesc },
      asAdmin(),
    );

    expect(invites).toMatchSnapshot();
  });

  it('descending orderBy + first', async () => {
    const invites = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdDesc, first: 3 },
      asAdmin(),
    );

    expect(invites).toMatchSnapshot();
  });

  it('descending orderBy + last', async () => {
    const invites = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdDesc, last: 3 },
      asAdmin(),
    );

    expect(invites).toMatchSnapshot();
  });

  it('orderBy + offset', async () => {
    const invites = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdAsc, offset: 3 },
      asAdmin(),
    );

    expect(invites).toMatchSnapshot();
  });

  it('orderBy + first + offset', async () => {
    const invites = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdAsc, first: 3, offset: 5 },
      asAdmin(),
    );

    expect(invites).toMatchSnapshot();
  });

  it('orderBy + last + offset', async () => {
    const invites = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdAsc, last: 3, offset: 5 },
      asAdmin(),
    );

    expect(invites).toMatchSnapshot();
  });

  it('descending orderBy + offset', async () => {
    const invites = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdDesc, offset: 3 },
      asAdmin(),
    );

    expect(invites).toMatchSnapshot();
  });

  it('descending orderBy + first + offset', async () => {
    const invites = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdDesc, first: 3, offset: 5 },
      asAdmin(),
    );

    expect(invites).toMatchSnapshot();
  });

  it('descending orderBy + last + offset', async () => {
    const invites = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdDesc, last: 3, offset: 5 },
      asAdmin(),
    );

    expect(invites).toMatchSnapshot();
  });

  it('filter', async () => {
    const filter = {
      username: 'hazel528',
    };

    const invites = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdAsc, filter },
      asAdmin(),
    );

    expect(invites).toMatchSnapshot();
  });

  it('filter with no results', async () => {
    const filter = {
      username: '---not-found---',
    };

    const invites = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdAsc, filter },
      asAdmin(),
    );

    expect(invites).toMatchSnapshot();
  });

  it('filter with mutliple attributes', async () => {
    const filter = {
      username: 'carissa722',
      inviteCount: {
        $gt: 5,
      },
    };

    const invites = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdAsc, filter },
      asAdmin(),
    );

    expect(invites).toMatchSnapshot();
  });

  it('filter with invalid attributes (reject)', async () => {
    const filter = {
      someAttributes: 'Veritatis nihil cum',
    };

    await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdAsc, filter },
      asAdmin(),
    ).catch(e => {
      expect(e).toMatchSnapshot();
    });
  });

  it('parentConnection', async () => {
    const parentConnection = {
      id: 79,
      attribute: 'inviterId',
    };

    const result = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdAsc },
      asAdmin(),
      parentConnection,
    );

    expect(result).toMatchSnapshot();
  });

  it('parentConnection + first', async () => {
    const parentConnection = {
      id: 79,
      attribute: 'inviterId',
    };

    const result = await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdAsc, first: 1 },
      asAdmin(),
      parentConnection,
    );

    expect(result).toMatchSnapshot();
  });

  it('parentConnection with invalid attribute (reject)', async () => {
    const parentConnection = {
      id: 60,
      attribute: 'invalidAttributeName',
    };

    await find(
      BoardMemberView,
      { ...orderByBoardIdAndInviterIdAsc, first: 1 },
      asAdmin(),
      parentConnection,
    ).catch(e => {
      expect(e).toMatchSnapshot();
    });
  });
});
